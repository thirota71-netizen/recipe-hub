"""Recipe Hub: local-first recipe index and optional Brave web search. Python 3.12+."""
import hashlib
import html
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import unicodedata
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib import request, parse, robotparser, error

ROOT = Path(__file__).parent
DB = Path(os.environ.get('RECIPE_DB', str(ROOT / 'data' / 'recipes.db')))
SITES = {'www.kurashiru.com': 'クラシル', 'delishkitchen.tv': 'DELISH KITCHEN',
         'cookpad.com': 'クックパッド', 'recipe.rakuten.co.jp': '楽天レシピ',
         'www.kikkoman.co.jp': 'キッコーマン', 'www.sirogohan.com': '白ごはん.com'}
UA = 'RecipeHub/1.0 (personal recipe reader)'
MAX_BYTES = 3_000_000
IMPORT_LOCK = threading.Lock()

def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB, timeout=20)
    conn.execute('CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, url TEXT UNIQUE, body TEXT NOT NULL)')
    return conn

def clean(value):
    return html.unescape(re.sub(r'<[^>]*>', '', str(value or ''))).strip()

def folded(value):
    return unicodedata.normalize('NFKC', str(value)).casefold()

def minutes(value):
    m = re.fullmatch(r'P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?', str(value or ''))
    if not m:
        return None
    d, h, mins, s = [int(x or 0) for x in m.groups()]
    return d * 1440 + h * 60 + mins + (1 if s else 0)

def flatten_steps(value):
    if isinstance(value, str):
        return [clean(s) for s in value.splitlines() if clean(s)]
    if isinstance(value, list):
        return [s for v in value for s in flatten_steps(v)]
    if isinstance(value, dict):
        if value.get('itemListElement'):
            return flatten_steps(value['itemListElement'])
        return flatten_steps(value.get('text') or value.get('name') or '')
    return []

def ingredients(value):
    if isinstance(value, dict) and value.get('itemListElement'):
        return ingredients(value['itemListElement'])
    values = value if isinstance(value, list) else [value] if value else []
    result = []
    for item in values:
        if isinstance(item, dict):
            item = ' '.join(str(item[k]) for k in ('value', 'unitText', 'unitCode', 'name') if item.get(k) is not None)
        if clean(item):
            result.append(clean(item))
    return result

class LDParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.capture = False
        self.buf = []
        self.blocks = []
    def handle_starttag(self, tag, attrs):
        if tag == 'script' and dict(attrs).get('type', '').lower().split(';')[0].strip() == 'application/ld+json':
            self.capture = True
            self.buf = []
    def handle_data(self, data):
        if self.capture:
            self.buf.append(data)
    def handle_endtag(self, tag):
        if tag == 'script' and self.capture:
            self.blocks.append(''.join(self.buf))
            self.capture = False

def find_recipes(node):
    if isinstance(node, list):
        for v in node:
            yield from find_recipes(v)
    elif isinstance(node, dict):
        types = node.get('@type', [])
        types = [types] if isinstance(types, str) else types
        if any(str(t).rstrip('/').split('/')[-1] == 'Recipe' for t in types):
            yield node
        for v in node.values():
            if isinstance(v, (dict, list)):
                yield from find_recipes(v)

def normalize(recipe, url):
    title = clean(recipe.get('name'))
    if not title:
        raise ValueError('レシピのタイトルがありません。')
    image = recipe.get('image')
    if isinstance(image, list):
        image = image[0] if image else ''
    if isinstance(image, dict):
        image = image.get('url') or image.get('contentUrl')
    image = parse.urljoin(url, str(image)) if image else ''
    if parse.urlsplit(image).scheme != 'https':
        image = ''
    total = minutes(recipe.get('totalTime'))
    if total is None:
        prep, cook = minutes(recipe.get('prepTime')), minutes(recipe.get('cookTime'))
        total = (prep or 0) + (cook or 0) if prep is not None or cook is not None else None
    author = recipe.get('author', '')
    if isinstance(author, list):
        author = ' / '.join(clean(v.get('name') if isinstance(v, dict) else v) for v in author)
    elif isinstance(author, dict):
        author = author.get('name', '')
    yield_value = recipe.get('recipeYield', '')
    if isinstance(yield_value, list):
        yield_value = ' / '.join(map(str, yield_value))
    return {'id': hashlib.sha256(url.encode()).hexdigest()[:20], 'url': url,
            'title': title, 'description': clean(recipe.get('description')),
            'site': SITES.get(parse.urlsplit(url).hostname, parse.urlsplit(url).hostname),
            'image': image, 'minutes': total, 'servings': clean(yield_value),
            'author': clean(author), 'ingredients': ingredients(recipe.get('recipeIngredient')),
            'steps': flatten_steps(recipe.get('recipeInstructions'))}

def parse_recipe(document, url):
    parser = LDParser()
    parser.feed(document)
    for block in parser.blocks:
        try:
            nodes = list(find_recipes(json.loads(block)))
        except (ValueError, TypeError):
            continue
        for node in nodes:
            if node.get('name'):
                return normalize(node, url)
    raise ValueError('このページからレシピ情報を取得できませんでした。Recipe形式の構造化データが必要です。元サイトをご覧ください。')

def validate_url(url):
    p = parse.urlsplit(url)
    if p.scheme != 'https' or p.hostname not in SITES or p.username or p.password or p.port not in (None, 443):
        raise ValueError('対応サイトのHTTPSレシピURLを入力してください。')
    return parse.urlunsplit(('https', p.hostname, p.path or '/', p.query, ''))

class SafeRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def fetch(url):
    url = validate_url(url)
    opener = request.build_opener(SafeRedirect())
    req = request.Request(url, headers={'User-Agent': UA, 'Accept': 'text/html,application/json'})
    with opener.open(req, timeout=12) as response:
        content = response.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise ValueError('ページのサイズが大きすぎます。')
        return content.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')

def import_recipe(url):
    url = validate_url(url)
    # Serialize fetches; respect robots and never bypass authentication or paywalls.
    with IMPORT_LOCK:
        robots = robotparser.RobotFileParser()
        try:
            robots.parse(fetch(parse.urljoin(url, '/robots.txt')).splitlines())
        except error.HTTPError as e:
            if e.code in (401, 403):
                raise ValueError('サイトが自動取得を許可していません。') from e
            if e.code != 404:
                raise ValueError('サイトの取得可否を確認できませんでした。') from e
            robots.parse([])
        except (OSError, ValueError) as e:
            raise ValueError('サイトの取得可否を確認できませんでした。') from e
        if not robots.can_fetch(UA, url):
            raise ValueError('このページは自動取得が許可されていません。元サイトをご覧ください。')
        recipe = parse_recipe(fetch(url), url)
    with connect() as conn:
        conn.execute('INSERT INTO recipes VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET body=excluded.body',
                     (recipe['id'], url, json.dumps(recipe, ensure_ascii=False)))
    return recipe

def local_search(q='', site='', max_minutes=0, sort='relevance'):
    with connect() as conn:
        recipes = [json.loads(row[0]) for row in conn.execute('SELECT body FROM recipes ORDER BY rowid DESC')]
    words = folded(q).split()
    result = []
    for recipe in recipes:
        text = folded(' '.join([recipe['title'], recipe['description'], *recipe['ingredients']]))
        if not all(w in text for w in words):
            continue
        if site and recipe['site'] != site:
            continue
        if max_minutes and (recipe['minutes'] is None or recipe['minutes'] > max_minutes):
            continue
        result.append(recipe)
    if sort == 'time':
        result.sort(key=lambda r: r['minutes'] if r['minutes'] is not None else float('inf'))
    return result

def web_search(q):
    key = os.environ.get('BRAVE_SEARCH_API_KEY')
    if not key:
        raise ValueError('Web横断検索にはBRAVE_SEARCH_API_KEYの設定が必要です。URLからの取り込みと登録済みレシピの検索はそのまま使えます。')
    if not q.strip() or len(q) > 150:
        raise ValueError('検索語を1〜150文字で入力してください。')
    query = q + ' レシピ (' + ' OR '.join('site:' + host for host in SITES) + ')'
    endpoint = 'https://api.search.brave.com/res/v1/web/search?' + parse.urlencode({'q': query, 'count': 10, 'country': 'JP', 'search_lang': 'jp'})
    req = request.Request(endpoint, headers={'X-Subscription-Token': key, 'Accept': 'application/json'})
    with request.urlopen(req, timeout=15) as response:
        data = json.loads(response.read(MAX_BYTES))
    urls = []
    for result in data.get('web', {}).get('results', []):
        try:
            url = validate_url(result.get('url', ''))
        except ValueError:
            continue
        if url not in urls:
            urls.append(url)
    imported, skipped = [], []
    # Fetch only ten explicit results per user search, not broad crawling.
    for url in urls[:10]:
        try:
            imported.append(import_recipe(url))
        except (ValueError, OSError) as e:
            skipped.append({'url': url, 'reason': str(e) if isinstance(e, ValueError) else 'ページを取得できませんでした。'})
    return {'imported': len(imported), 'skipped': skipped, 'found': len(urls)}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'public'), **kwargs)
    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)
    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        super().end_headers()
    def do_GET(self):
        p = parse.urlsplit(self.path)
        params = parse.parse_qs(p.query)
        def val(k, default=''):
            return params.get(k, [default])[0]
        if p.path == '/api/config':
            return self.send_json(200, {'sites': SITES, 'webSearch': bool(os.environ.get('BRAVE_SEARCH_API_KEY'))})
        if p.path == '/api/recipes':
            try:
                maximum = int(val('minutes', '0'))
                rows = local_search(val('q'), val('site'), maximum, val('sort'))
                return self.send_json(200, {'recipes': rows})
            except ValueError:
                return self.send_json(400, {'error': '時間の指定が不正です。'})
        if p.path.startswith('/api/'):
            return self.send_json(404, {'error': '見つかりません。'})
        return super().do_GET()
    def do_POST(self):
        # Same-origin browser writes only. Default binding is localhost.
        origin = self.headers.get('Origin')
        if origin and parse.urlsplit(origin).netloc != self.headers.get('Host'):
            return self.send_json(403, {'error': '別のサイトからの操作はできません。'})
        if not self.headers.get('Content-Type', '').startswith('application/json'):
            return self.send_json(415, {'error': 'JSONを指定してください。'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 8192:
                raise ValueError('リクエストのサイズが不正です。')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('JSONオブジェクトを指定してください。')
            if self.path == '/api/import':
                url = data.get('url')
                if not isinstance(url, str):
                    raise ValueError('URLを入力してください。')
                return self.send_json(200, {'recipe': import_recipe(url)})
            if self.path == '/api/web-search':
                q = data.get('q')
                if not isinstance(q, str):
                    raise ValueError('検索語を入力してください。')
                return self.send_json(200, web_search(q))
            return self.send_json(404, {'error': '見つかりません。'})
        except (ValueError, TypeError) as e:
            return self.send_json(400, {'error': str(e)})
        except (OSError, error.URLError):
            return self.send_json(502, {'error': '外部サイトに接続できませんでした。時間をおいて再度お試しください。'})

if __name__ == '__main__':
    host, port = os.environ.get('HOST', '127.0.0.1'), int(os.environ.get('PORT', '8000'))
    connect().close()
    print(f'Recipe Hub: http://{host}:{port}', flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()
