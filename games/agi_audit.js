// AGI-potential audit of starfighter.html — proves where the agent is scripted / handed / hardcoded.
const fs=require('fs');
const html=fs.readFileSync('D:/code/Tami/.opus-tools/agi_proto/starfighter/starfighter.html','utf8');
const m=html.match(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i);
const src=m[1];
const lines=src.split('\n');
const learned=/\bLANG\b|\bnavGain\b|\bTOM\b|langPick|tomPredict|langEpisode|\.navAccum|LANG\.sig|LANG\.resp/;

// 1) MODE-DECISION SITES: does the policy read any LEARNED state? (proves scripted-vs-learned)
const modeSites=lines.filter(l=>/\bmode\s*=\s*['"][A-Z]/.test(l));
const modeSitesLearned=modeSites.filter(l=>learned.test(l));

// 2) HANDED PERCEPTION: exact .pos reads vs any perception-noise. A grounded agent senses noisily.
const posReads=(src.match(/\.pos\b/g)||[]).length;
const noiseUses=(src.match(/perceiveNoise|senseNoise|\bnoisyPos\b|observationNoise/g)||[]).length;

// 3) MAGIC NUMBERS IN LOGIC: numeric literals inside if(...) conditions that are NOT CFG.* references.
//    (the no-hardcode law: every tunable should be a named CFG const)
let magicInIf=0; const magicExamples=[];
for(const l of lines){
  const mm=l.match(/\bif\s*\(([^)]*)\)/g); if(!mm) continue;
  for(const cond of mm){
    // strip CFG.NAME tokens, then look for bare decimals like 0.4, 1.3, 45, *1.5
    const stripped=cond.replace(/CFG\.[A-Z_0-9]+/g,'').replace(/\b(?:id|i|j|k|f|t)\b/g,'');
    const nums=stripped.match(/(?<![\w.])\d+\.?\d*/g)||[];
    const real=nums.filter(n=>!/^[01]$/.test(n)); // ignore 0 and 1 (loop bounds/booleans)
    if(real.length){ magicInIf+=real.length; if(magicExamples.length<8) magicExamples.push(cond.trim().slice(0,70)+'  ->  ['+real.join(',')+']'); }
  }
}

// 4) A1 task is HANDED not discovered: CORRECT mapping + situation categories authored in source.
const authoredTask=/const CORRECT\s*=\s*\[[^\]]*\]/.test(src) && /SIT_NAMES\s*=\s*\[/.test(src);

// 5) A2 model is a HAND-CODED inference rule (facing+proximity), not learned.
const tomHandcoded=/face\.dot\(to\).*d\/CFG\.TOM_R/.test(src.replace(/\n/g,' '));

// 6) size of the genuinely-learned parameter vector (A1 code 3x3x2 + A3 one scalar/ship)
const langParams=3*3*2; // sig 3x3 + resp 3x3
console.log(JSON.stringify({
  mode_decision_sites: modeSites.length,
  mode_sites_that_read_learned_state: modeSitesLearned.length,
  '=> policy is': modeSitesLearned.length===0?'100% SCRIPTED (no learned state touches the mode decision)':'partly learned',
  exact_pos_reads: posReads,
  perception_noise_functions: noiseUses,
  '=> perception is': noiseUses===0?'HANDED (perfect global positions, zero sensing/noise/occlusion)':'grounded',
  magic_numbers_in_if_conditions: magicInIf,
  magic_examples: magicExamples,
  a1_task_authored_not_discovered: authoredTask,
  a2_is_handcoded_inference_rule: tomHandcoded,
  total_learned_parameters_in_game: langParams+ ' (A1 code) + ~1 scalar/ship (A3 gain)',
},null,1));
