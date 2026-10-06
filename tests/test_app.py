import json
import os
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib import request, error
from http.server import ThreadingHTTPServer
import app


def document(name='鶏肉の炒め物', **extra):
    data = {'@type': 'Recipe', 'name': name, 'recipeIngredient': ['鶏肉 200g', 'キャベツ 2枚'],
            'recipeInstructions': [{'@type': 'HowToSection', 'itemListElement': [
                {'@type': 'HowToStep', 'text': '材料を切る。'}, {'text': '炒める。'}]}],
            'totalTime': 'PT20M', 'recipeYield': '2人分', **extra}
    return '<script type="application/ld+json">' + json.dumps({'@graph': [data]}, ensure_ascii=False) + '</script>'


class RecipeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = patch.object(app, 'DB', app.Path(self.temp.name) / 'test.db')
        self.db.start()
    def tearDown(self):
        self.db.stop()
        self.temp.cleanup()
    def store(self, recipe):
        with app.connect() as conn:
            conn.execute('INSERT INTO recipes VALUES (?, ?, ?)', (recipe['id'], recipe['url'], json.dumps(recipe)))
    def test_normalize_graph_and_sections(self):
        r = app.parse_recipe(document(author={'name': '作者'}, image={'url': '/image.jpg'}), 'https://www.kurashiru.com/recipes/one')
        self.assertEqual(r['steps'], ['材料を切る。', '炒める。'])
        self.assertEqual(r['minutes'], 20)
        self.assertEqual(r['author'], '作者')
        self.assertEqual(r['image'], 'https://www.kurashiru.com/image.jpg')
        self.assertEqual(r['site'], 'クラシル')
    def test_missing_and_unsafe_image(self):
        r = app.parse_recipe(document(totalTime=None), 'https://cookpad.com/recipe/one')
        self.assertIsNone(r['minutes'])
        self.assertEqual(r['image'], '')
        r = app.parse_recipe(document(image='javascript:alert(1)'), 'https://cookpad.com/recipe/one')
        self.assertEqual(r['image'], '')
    def test_duration_and_structured_ingredients(self):
        r = app.parse_recipe(document(totalTime=None, prepTime='PT15M', cookTime='PT1H',
          recipeIngredient=[{'@type': 'PropertyValue', 'name': '卵', 'value': 2, 'unitText': '個'}]), 'https://recipe.rakuten.co.jp/recipe/one')
        self.assertEqual(r['minutes'], 75)
        self.assertEqual(r['ingredients'], ['2 個 卵'])
        self.assertEqual(app.minutes('P1DT1H'), 1500)
    def test_multiple_sites_filters_unknown_time_and_sort(self):
        self.store(app.parse_recipe(document(), 'https://www.kurashiru.com/recipes/a'))
        self.store(app.parse_recipe(document(totalTime='PT10M'), 'https://cookpad.com/recipe/b'))
        self.store(app.parse_recipe(document(totalTime=None), 'https://recipe.rakuten.co.jp/recipe/c'))
        self.assertEqual(len(app.local_search('鶏肉　キャベツ')), 3)
        self.assertEqual(len(app.local_search('鶏肉', max_minutes=15)), 1)
        self.assertEqual(len(app.local_search(site='クラシル')), 1)
        self.assertEqual([r['minutes'] for r in app.local_search(sort='time')], [10, 20, None])
        self.assertEqual(app.local_search('存在しない'), [])
    def test_allowlist_and_redirect_validation(self):
        for url in ['http://cookpad.com/a', 'https://127.0.0.1/a', 'https://cookpad.com.evil.test/a',
                    'https://user@cookpad.com/a', 'https://cookpad.com:444/a', 'file:///etc/passwd']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                app.validate_url(url)
        self.assertEqual(app.validate_url('https://cookpad.com/a#test'), 'https://cookpad.com/a')
        with self.assertRaises(ValueError):
            app.SafeRedirect().redirect_request(None, None, 302, '', {}, 'http://localhost/private')
    def test_import_is_persistent_and_deduplicated(self):
        def fake_fetch(url):
            return 'User-agent: *\nAllow: /' if url.endswith('robots.txt') else document()
        with patch.object(app, 'fetch', side_effect=fake_fetch):
            app.import_recipe('https://cookpad.com/recipe/a')
            app.import_recipe('https://cookpad.com/recipe/a')
        self.assertEqual(len(app.local_search()), 1)
        self.assertEqual(app.local_search()[0]['title'], '鶏肉の炒め物')
    def test_robots_denial(self):
        with patch.object(app, 'fetch', return_value='User-agent: *\nDisallow: /') as fetch:
            with self.assertRaises(ValueError):
                app.import_recipe('https://cookpad.com/recipe/a')
            self.assertEqual(fetch.call_count, 1)
    def test_no_recipe(self):
        with self.assertRaises(ValueError):
            app.parse_recipe('<script type="application/ld+json">broken</script>', 'https://cookpad.com/a')
    def test_web_search_requires_key(self):
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(ValueError):
            app.web_search('鶏肉')
    def test_web_search_imports_supported_results(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size):
                return json.dumps({'web': {'results': [{'url': 'https://cookpad.com/recipe/a'},
                   {'url': 'https://cookpad.com/recipe/a'}, {'url': 'https://evil.test/a'}]}}).encode()
        with patch.dict(os.environ, {'BRAVE_SEARCH_API_KEY': 'test'}), patch.object(app.request, 'urlopen', return_value=Response()), patch.object(app, 'import_recipe', return_value={}) as importer:
            result = app.web_search('鶏肉')
            self.assertEqual(result['imported'], 1)
            self.assertEqual(importer.call_count, 1)
    def test_http_api_and_cross_origin_rejection(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            with request.urlopen(base + '/api/recipes') as response:
                self.assertEqual(json.load(response), {'recipes': []})
            with request.urlopen(base + '/') as response:
                self.assertIn('Recipe Hub', response.read().decode())
            req = request.Request(base + '/api/import', data=b'{"url":"https://localhost/a"}', headers={'Content-Type': 'application/json'})
            with self.assertRaises(error.HTTPError) as cm:
                request.urlopen(req)
            self.assertEqual(cm.exception.code, 400)
            req = request.Request(base + '/api/import', data=b'{}', headers={'Content-Type': 'application/json', 'Origin': 'https://evil.test'})
            with self.assertRaises(error.HTTPError) as cm:
                request.urlopen(req)
            self.assertEqual(cm.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
