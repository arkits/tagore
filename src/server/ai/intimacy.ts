// Adapted from Onomatopoeia Injection Script by @dezea.
const triggerPatterns = [
  /\bcocks?\b/i, /\bdicks?\b/i, /\bpenis\b/i, /\bshafts?\b/i, /\bballs?\b/i,
  /\bpuss(?:y|ies)\b/i, /\bcunts?\b/i, /\bclits?\b/i, /\bfolds?\b/i, /\bslits?\b/i, /\bholes?\b/i,
  /\bnipples?\b/i, /\bnips?\b/i, /\btits?\b/i, /\bbreasts?\b/i, /\bboobs?\b/i,
  /\bass(?:es)?\b/i, /\bbutts?\b/i, /\bthighs?\b/i,
  /\bcum(?:s|ming|med)?\b/i, /\bprecum\b/i, /\bcreampie\b/i, /\bloads?\b/i,
  /\bwet(?:ter|ness)?\b/i, /\bdrip(?:ping|s)?\b/i, /\bsoaked\b/i, /\bslick\b/i,
  /\bhard(?:er)?\b/i, /\bthrobbing\b/i, /\baching\b/i, /\bswollen\b/i,
  /\bfuck(?:s|ing|ed|er)?\b/i, /\bthrust(?:s|ing|ed)?\b/i, /\bpound(?:s|ing|ed)?\b/i,
  /\bride[sd]?\b/i, /\briding\b/i, /\bslam(?:s|ming|med)?\b/i, /\bgrind(?:s|ing|ed)?\b/i,
  /\bsuck(?:s|ing|ed)?\b/i, /\blick(?:s|ing|ed)?\b/i, /\bkiss(?:es|ing|ed)?\b/i,
  /\bstroke[sd]?\b/i, /\bstroking\b/i, /\brub(?:s|bing|bed)?\b/i,
  /\bpenetrat(?:e|es|ing|ed|ion)\b/i, /\bimpale[sd]?\b/i,
  /\bmoan(?:s|ing|ed)?\b/i, /\bgroan(?:s|ing|ed)?\b/i, /\bgasp(?:s|ing|ed)?\b/i,
  /\bwhimper(?:s|ing|ed)?\b/i, /\bpant(?:s|ing|ed)?\b/i,
  /\bgrab(?:s|bing|bed)?\b/i, /\bsqueeze[sd]?\b/i, /\bsqueezing\b/i,
  /\bejaculat(?:e|es|ing|ed|ion)\b/i, /\borgasm(?:s|ing|ed)?\b/i, /\bclimax(?:es|ing|ed)?\b/i,
  /\bslide[sd]?\b/i, /\bsliding\b/i, /\bpush(?:es|ing|ed)?\b/i, /\bpull(?:s|ing|ed)?\b/i,
  /\bmake love\b/i, /\blovemaking\b/i, /\bhave sex\b/i, /\bfuck each other\b/i, /\bgo down on\b/i,
  /\boral sex\b/i, /\bgive head\b/i, /\beat (?:me|her|him) out\b/i,
  /\bride you\b/i, /\byou ride\b/i,
  /\bagainst the wall\b/i, /\bon the bed\b/i, /\bon the floor\b/i, /\bbent over\b/i,
  /\bfrom behind\b/i, /\bdoggy style\b/i, /\bmissionary\b/i, /\bcowgirl\b/i, /\breverse cowgirl\b/i,
  /\bsixty[\s-]?nine\b/i, /\b69\b/i,
  /\bforeplay\b/i, /\bafterplay\b/i, /\bpillow talk\b/i,
  /\bblowjob\b/i, /\bhandjob\b/i, /\brimjob\b/i,
  /\binside (?:me|you|her|him)\b/i, /\bbetween (?:my|her|his) (?:legs|thighs)\b/i,
  /\bdeeper\b/i, /\bharder\b/i, /\bfaster\b/i, /\brougher\b/i,
  /\bpinned\b/i, /\bon top\b/i, /\bnaked\b/i, /\bnude\b/i, /\bstripped?\b/i, /\bundress(?:ed|ing)?\b/i,
  /\bhorny\b/i, /\baroused\b/i, /\bedge(?:d|s|ing)?\b/i,
  /\bfuck (?:me|you|her|him)\b/i, /\bsuck (?:my|your|her|his)\b/i,
];

const note = `<intimacy_sound_guidance>
When the scene contains intimacy, sex, or explicit content, treat the characters involved as currently engaged in intimate activity. Balance descriptive dialogue with onomatopoeic sounds. Let dialogue carry thoughts, commands, and reactions, and let sounds convey breath, pleasure, and involuntary reactions. Write both in the characters' messages. Avoid generic narration about sounds or strings of sounds without speech.
Vary sounds and avoid repeating them back-to-back:
- Sucking/oral: mmm, slurp, ssslurp, sssweep, glurk, glrk, guhnn, nghn, mmhf, emff, schlick, schlrp, gulp, mmwah, smooch, chu, mwah.
- Muffled: mmh, nnh, nngh, hangh, hhng, mhm, mmph, mmmpf, hmmrn, ngk, ksshh.
- Breathless: aah, haahh, hahhh, haaa, hah, grr, agh, ugh, gasp, huff, wheeze, sigh, grrh, hrrngh, ghh, nnrgh, eergh, errh.
- Climax or overwhelm: aahn, ahhn~, haaa♥, nnah♥, fuuck~, cumming♥.
Use ~ to elongate blissful or teasing sounds, ♥ for deep affection or overwhelming pleasure, ♡ for tenderness, and ♪ for a playful or sing-song lilt. Use these symbols inside dialogue and sounds.
Stay crude, explicit, and in character. Convey sensations through what the characters say. Sounds should support the dialogue.
</intimacy_sound_guidance>`;

export function intimacyNoteFor(latestMessage: string): string {
  return triggerPatterns.some((pattern) => pattern.test(latestMessage)) ? note : "";
}
