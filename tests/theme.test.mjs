import test from 'node:test';
import assert from 'node:assert/strict';
import {PRESETS,VARIANTS,MODES,DEFAULT_THEME,normalizeTheme,schemeColors,swatch} from '../app/theme.mjs';

const hex=/^#[0-9a-f]{6}$/i;
const luminance=h=>{const [r,g,b]=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(c=>c<=.03928?c/12.92:((c+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;};
const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};

test('配色设置会清理无效值并保留合法的自定义主色',()=>{
 assert.deepEqual(normalizeTheme(null),DEFAULT_THEME);
 assert.deepEqual(normalizeTheme({seed:'red',variant:'loud',mode:'night',preset:'nope'}),{...DEFAULT_THEME,preset:'custom'});
 const t=normalizeTheme({preset:'custom',seed:'#00897b',variant:'vibrant',mode:'system'});
 assert.equal(t.seed,'#00897b');assert.equal(t.variant,'vibrant');assert.equal(t.mode,'system');
 assert.ok(PRESETS.length>=5&&VARIANTS.length===4&&MODES.length===3);
});

test('每套预设在浅色和深色下都生成完整且可读的配色',()=>{
 for(const p of PRESETS)for(const dark of [false,true]){
  const c=schemeColors(p.seed,p.variant||'tonal',dark);
  for(const [role,value] of Object.entries(c))assert.match(value,hex,`${p.id} ${role}`);
  assert.ok(contrast(c.onSurface,c.surface)>=7,`${p.id} 正文对比度`);
  assert.ok(contrast(c.onPrimary,c.primary)>=4.5,`${p.id} 主按钮对比度`);
  assert.ok(contrast(c.onPrimaryContainer,c.primaryContainer)>=4.5,`${p.id} 容器对比度`);
  assert.equal(luminance(c.surface)<.2,dark,`${p.id} ${dark?'深色':'浅色'}表面`);
 }
});

test('不同主色和风格生成不同的配色，色板预览可用',()=>{
 const primaries=new Set(PRESETS.map(p=>schemeColors(p.seed,p.variant||'tonal',false).primary));
 assert.equal(primaries.size,PRESETS.length);
 const styles=new Set(VARIANTS.map(([v])=>schemeColors('#6750a4',v,false).primaryContainer));
 assert.ok(styles.size>=3);
 const s=swatch('#e0662b','expressive');for(const v of Object.values(s))assert.match(v,hex);
});
