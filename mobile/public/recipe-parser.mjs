const compact=s=>s.normalize('NFKC').replace(/[【】\[\]《》〈〉■◆●★]/g,'').replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}])/gu,'').trim();
const stepMarker=/^(?:[①-⑳]|(?:step\s*)?[\d０-９]+\s*[.)．、:：]|[（(][\d０-９]+[)）])\s*/i;
const action=/切[るりっ]|炒[める]|焼[くきい]|煮[る込]|混[ぜ合]|加え|入れ|茹で|ゆで|蒸[すし]|盛[るり]|漬[ける]|揚[げる]|冷[ますや]|温[める]|[\p{L}]\s*(?:を|に|で|と)\s*[\p{L}].*(?:する|ます|せる)|\b(?:cut|chop|mix|heat|cook|bake|fry|boil|add|stir|serve|slice|pour|simmer|preheat)\b/i;
const quantity=/(?:\d|[０-９½¼¾])\s*(?:g|kg|ml|l|個|本|枚|袋|束|株|尾|匹|杯|片|缶|粒|合|cup|tsp|tbsp|oz|lb)|大\s*さじ|小\s*さじ|適量|少々|ひとつまみ|\bto taste\b/i;
export function parseDraft(text){
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const draft={title:'',ingredients:[],steps:[],description:[],servings:'',minutes:''};let section='',numbered=false;const undecided=[];
  for(const raw of lines){
    const normalized=compact(raw);
    const ingredientHeading=normalized.match(/^(?:材料(?:・分量)?|ingredients)\s*(?:[（(]([^）)]+)[）)])?\s*[:：]?\s*(.*)$/i);
    const stepHeading=normalized.match(/^(?:作り方|作りかた|作り方・手順|調理手順|手順|作りかたの手順|instructions|directions|method|preparation)\s*[:：]?\s*(.*)$/i);
    if(ingredientHeading){section='ingredients';if(ingredientHeading[1])draft.servings=ingredientHeading[1];if(ingredientHeading[2])draft.ingredients.push(ingredientHeading[2]);continue;}
    if(stepHeading){section='steps';if(stepHeading[1])draft.steps.push(stepHeading[1].replace(stepMarker,''));continue;}
    const time=normalized.match(/^(?:調理時間|時間|total time)\s*[:：]?\s*(?:(\d+)\s*時間)?\s*(?:(\d+)\s*(?:分|min(?:utes)?))?$/i);
    if(time&&(time[1]||time[2])){draft.minutes=String(Number(time[1]||0)*60+Number(time[2]||0));continue;}
    const servings=normalized.match(/^(?:分量|servings|yield)\s*[:：]\s*(.+)$/i);if(servings){draft.servings=servings[1];continue;}
    if(/^(?:ポイント|コツ|メモ|備考|notes?|tips?)\s*[:：]?$/i.test(normalized)){section='description';continue;}
    if(!draft.title&&!section&&!stepMarker.test(raw)&&!quantity.test(raw)){draft.title=raw.slice(0,200);continue;}
    if(stepMarker.test(raw)){section='steps';numbered=true;draft.steps.push(raw.replace(stepMarker,''));continue;}
    if(section==='ingredients'){if(action.test(normalized)&&!quantity.test(normalized)){section='steps';draft.steps.push(raw);}else draft.ingredients.push(raw);continue;}
    if(section==='steps'){if(numbered&&draft.steps.length)draft.steps[draft.steps.length-1]+=' '+raw;else draft.steps.push(raw);continue;}
    if(section==='description'){draft.description.push(raw);continue;}
    undecided.push(raw);
  }
  // Extract real quantity lines and cooking sentences even when a PDF omitted headings.
  for(const raw of undecided){const normalized=compact(raw);if(quantity.test(normalized)&&!action.test(normalized))draft.ingredients.push(raw);else if(action.test(normalized))draft.steps.push(raw);else draft.description.push(raw);}
  if(!draft.title)draft.title=lines.find(s=>!quantity.test(compact(s))&&!stepMarker.test(s))?.slice(0,200)||'';
  draft.description=draft.description.join('\n');return draft;
}
export function applyAutoDraft(draft,snapshot,fields){let kept=false;for(const [field,input] of Object.entries(fields)){if(draft[field]===undefined)continue;if(input.value!==snapshot[field]){kept=true;continue;}const next=Array.isArray(draft[field])?draft[field].join('\n'):draft[field];input.value=next;}return kept;}
