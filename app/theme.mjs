// Material You dynamic colour: one seed colour generates the whole UI palette (light and dark),
// the same way Pixel's "Wallpaper & style" does. Colours land on :root as CSS custom properties.
import {argbFromHex,hexFromArgb,Hct,TonalPalette,Blend,SchemeTonalSpot,SchemeVibrant,SchemeExpressive,SchemeNeutral,MaterialDynamicColors as M} from './vendor/material-color.mjs';

export const PRESETS=[
 {id:'lavender',name:'薰衣草',seed:'#6750a4'},
 {id:'ocean',name:'海湾蓝',seed:'#1b6ef3'},
 {id:'mint',name:'薄荷绿',seed:'#2e7d4f'},
 {id:'coral',name:'珊瑚橙',seed:'#e0662b'},
 {id:'sakura',name:'樱花粉',seed:'#d0477e'},
 {id:'graphite',name:'石墨灰',seed:'#5f6b7a',variant:'neutral'}
];
export const VARIANTS=[['tonal','柔和',SchemeTonalSpot],['vibrant','鲜明',SchemeVibrant],['expressive','表现力',SchemeExpressive],['neutral','中性',SchemeNeutral]];
export const MODES=[['light','浅色','light'],['dark','深色','dark'],['system','跟随系统','auto']];
export const DEFAULT_THEME={preset:'lavender',seed:'#6750a4',variant:'tonal',mode:'light'};
const SPEC='2025';
const ROLES=['primary','onPrimary','primaryContainer','onPrimaryContainer','secondary','onSecondary','secondaryContainer','onSecondaryContainer','tertiary','onTertiary','tertiaryContainer','onTertiaryContainer','error','onError','errorContainer','onErrorContainer','surface','surfaceDim','surfaceBright','surfaceContainerLowest','surfaceContainerLow','surfaceContainer','surfaceContainerHigh','surfaceContainerHighest','onSurface','onSurfaceVariant','outline','outlineVariant','inverseSurface','inverseOnSurface','inversePrimary','scrim','shadow'];
// Cover colours a notebook can choose; harmonised toward the seed so they sit well with any theme.
const COVERS={olive:'#4f8a3a',sand:'#b8860b',blue:'#2f6fb0',pink:'#c2557c'};
const kebab=s=>s.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
const hexOk=v=>typeof v==='string'&&/^#[\da-f]{6}$/i.test(v);

export function normalizeTheme(raw){
 const t={...DEFAULT_THEME,...(raw&&typeof raw==='object'?raw:{})};
 if(!hexOk(t.seed))t.seed=DEFAULT_THEME.seed;
 if(!VARIANTS.some(([v])=>v===t.variant))t.variant=DEFAULT_THEME.variant;
 if(!MODES.some(([m])=>m===t.mode))t.mode=DEFAULT_THEME.mode;
 if(t.preset!=='custom'&&!PRESETS.some(p=>p.id===t.preset))t.preset='custom';
 return t;
}
function scheme(seed,variant,dark){const V=(VARIANTS.find(([v])=>v===variant)||VARIANTS[0])[2];return new V(Hct.fromInt(argbFromHex(seed)),dark,0,SPEC);}
export function schemeColors(seed,variant,dark){const s=scheme(seed,variant,dark),out={};for(const r of ROLES)out[r]=hexFromArgb(M[r].getArgb(s));return out;}
// Pixel-style swatch: primary over the top half, secondary and tertiary in the lower quarters.
export function swatch(seed,variant='tonal'){const s=scheme(seed,variant,false);return {a:hexFromArgb(s.primaryPalette.tone(70)),b:hexFromArgb(s.secondaryPalette.tone(85)),c:hexFromArgb(s.tertiaryPalette.tone(80))};}
export function isDark(theme){return theme.mode==='dark'||theme.mode==='system'&&!!globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;}

let current=null,mediaBound=false;
export function applyTheme(raw,onChange){
 const theme=normalizeTheme(raw),dark=isDark(theme),c=schemeColors(theme.seed,theme.variant,dark),light=dark?schemeColors(theme.seed,theme.variant,false):c;
 const root=document.documentElement;
 for(const [k,v] of Object.entries(c))root.style.setProperty('--md-'+kebab(k),v);
 const seedArgb=argbFromHex(theme.seed);
 for(const [name,hex] of Object.entries(COVERS)){
  const pal=TonalPalette.fromHueAndChroma(Hct.fromInt(Blend.harmonize(argbFromHex(hex),seedArgb)).hue,26);
  root.style.setProperty(`--cover-${name}`,hexFromArgb(pal.tone(dark?30:90)));
  root.style.setProperty(`--on-cover-${name}`,hexFromArgb(pal.tone(dark?90:20)));
  root.style.setProperty(`--cover-${name}-accent`,hexFromArgb(pal.tone(dark?80:50)));
 }
 root.dataset.mode=dark?'dark':'light';root.style.colorScheme=dark?'dark':'light';
 document.querySelector('meta[name=theme-color]')?.setAttribute('content',c.surface);
 current={theme,dark,colors:c,paper:{primary:light.primary,container:light.primaryContainer,onContainer:light.onPrimaryContainer,tertiary:light.tertiary,tertiaryContainer:light.tertiaryContainer}};
 if(!mediaBound&&globalThis.matchMedia){mediaBound=true;matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(current?.theme.mode==='system'){applyTheme(current.theme,onChange);onChange?.(current);}});}
 return current;
}
export function currentTheme(){return current;}
