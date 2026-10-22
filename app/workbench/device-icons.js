// 器件图标：统一 16×16 线性风格，currentColor 跟随主题
const DEVICE_RULES = [
  [/^Source_Randi/, '<path d="M1 10.5V5.5h2.6v5h2.6v-5h2.6v5h2.6v-5H15"/>'],
  [/^Source_Cosin/, '<path d="M1 8c2-4.5 4-4.5 6 0s4 4.5 6 0"/><path d="M1 8h14" opacity=".3"/>'],
  [/^Source_Rectpuls/, '<path d="M1 11V5h5.5v6H15"/>'],
  [/^Source_DC/, '<path d="M1 8h11"/><path d="M10 6l2.5 2L10 10"/>'],
  [/^Source_Sa/, '<path d="M1 11.2c1.7 0 2-6.4 3.6-6.4s1.9 6.4 3.6 6.4 1.9-3.4 3.4-3.4 1.7 2 3.4 2"/>'],

  [/^LineCode_Manchester/, '<path d="M1 10.5V5.5h3v5h3v-5h3v5h3v-5h2"/>'],
  [/^LineCode_Hdb3/, '<path d="M1 9V5h3.5v6h3V5h3.5v6h4"/>'],
  [/^LineCode_Ami/, '<path d="M1 8h1.5V4.5h3V11h3V4.5h3V11h3"/>'],
  [/^LineCode_Cmi/, '<path d="M1 10.5V5.5h2v5h3v-5h2v5h3v-5h2v5h2"/>'],
  [/^LineCode_Snrz/, '<path d="M1 10.5V5.5h3.5v5H8v-5h3.5v5H15"/>'],
  [/^LineCode_Srz/, '<path d="M1 10.5V5.5h2v5h2v-5h2v5h2v-5h2v5h2v-5h2"/>'],
  [/^LineCode_Dnrz/, '<path d="M1 10.5V5.5h3.5v5H8v-5h3.5v5H15"/><path d="M2.8 3.2v1.6M9.8 3.2v1.6"/>'],
  [/^LineCode_Drz/, '<path d="M1 10.5V5.5h2v5h1.5v-5h2v5h1.5v-5h2v5h1.5v-5h2"/>'],
  [/^LineCode_Diff/, '<path d="M1 10.5V5.5h3v5h3v-5h3v5h3v-5h2"/><path d="M3 3v2M9 3v2"/>'],
  [/^LineCode_/, '<path d="M1 10.5V5.5h3.5v5h3v-5h3.5v5H15"/>'],

  [/^ComUse_Adder/, '<circle cx="8" cy="8" r="6"/><path d="M8 5v6M5 8h6"/>'],
  [/^ComUse_Subtractor/, '<circle cx="8" cy="8" r="6"/><path d="M5 8h6"/>'],
  [/^ComUse_Multiplier/, '<circle cx="8" cy="8" r="6"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/>'],
  [/^ComUse_AWGN/, '<path d="M1 8l1.6-3.2L4.2 11l1.6-6 1.6 8 1.6-7 1.6 5 1.6-4 1.8 2"/>'],
  [/^ComUse_Delay/, '<path d="M1 8h3M12 8h3"/><rect x="4" y="5" width="8" height="6" rx="1"/><path d="M7 5v6"/>'],
  [/^ComUse_DownSample/, '<path d="M1 8h2.5l1.5-4 2 8 2-4H15"/><path d="M11 5v6M13 5v6"/>'],
  [/^ComUse_Judge/, '<path d="M1 8h5l1.5-3.5 2 7L11 8h4"/><path d="M1 4.5h14" stroke-dasharray="2 2" opacity=".45"/>'],
  [/^ComUse_Mod2/, '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5 5l6 6M11 5l-6 6"/>'],
  [/^ComUse_OnePass/, '<path d="M2 4h12l-4 4 4 4H2z"/>'],
  [/^ComUse_Rectifier/, '<path d="M1 8h4M11 8h4M5 4.5v7l6-3.5z"/>'],
  [/^ComUse_Relay/, '<rect x="2" y="4" width="5" height="8" rx="1"/><path d="M7 8h2M9 8l3-2.5M12 5.5V8"/>'],
  [/^ComUse_Sample/, '<path d="M1 11.5h2.5V4.5H6v7h2.5v-7H11v7h4"/>'],
  [/^ComUse_Select/, '<path d="M3 3h10l-2 5 2 5H3z"/><path d="M1 5h2M1 11h2M13 8h2"/>'],
  [/^ComUse_ZeroPass/, '<path d="M1 11.5h3V8h3V4.5h3v7h4"/>'],

  [/^Filter_BPF/, '<path d="M1 11h2c2 0 2-6 5-6s3 6 5 6h2"/>'],
  [/^Filter_BEF/, '<path d="M1 6h3c2 0 2 5 4 5s2-5 4-5h3"/>'],
  [/^Filter_LPF/, '<path d="M1 6h5c3 0 3 5 9 5"/>'],
  [/^Filter_HPF/, '<path d="M1 11h5c3 0 3-5 9-5"/>'],
  [/^Filter_/, '<path d="M1 11h2c2 0 2-6 5-6s3 6 5 6h2"/>'],

  [/^Modulation_Freq/, '<path d="M1 8c1.2-4 2.4-4 3.6 0s1.2 4 2.4 0 1.2-4 2.4 0 1.2 4 2.4 0 1.2-4 2.2 0"/>'],
  [/^Modulation_Phrase/, '<path d="M1 8c2-4 4-4 6 0s4 4 6 0"/><path d="M8 2v12" stroke-dasharray="2 2" opacity=".55"/>'],
  [/^Modulation_FskMod/, '<path d="M1 8c1-3 2-3 3 0s1 3 2 0M6 8c.8-4 1.6-4 2.4 0s1.6 4 2.4 0 1.6-4 2.4 0"/>'],
  [/^Modulation_FskDemod/, '<path d="M1 8c1-3 2-3 3 0s1 3 2 0"/><path d="M6 5v6M6 8h8"/>'],
  [/^Modulation_PskMod/, '<path d="M1 8c1.5-4 3-4 4.5 0s1.5 4 3 0M8 8c1.5 4 3 4 4.5 0s1.5-4 3 0"/>'],
  [/^Modulation_PskDemod/, '<path d="M1 8c1.5-4 3-4 4.5 0s1.5 4 3 0M8 8c1.5 4 3 4 4.5 0s1.5-4 3 0"/><path d="M1 11.5h14" stroke-dasharray="2 2" opacity=".45"/>'],
  [/^Modulation_QamMod/, '<circle cx="5" cy="5" r="1.2"/><circle cx="11" cy="5" r="1.2"/><circle cx="5" cy="11" r="1.2"/><circle cx="11" cy="11" r="1.2"/><path d="M2 8h12M8 2v12" opacity=".3"/>'],
  [/^Modulation_QamDemod/, '<rect x="2" y="2" width="12" height="12" rx="2"/><circle cx="6" cy="6" r="1"/><circle cx="10" cy="6" r="1"/><circle cx="6" cy="10" r="1"/><circle cx="10" cy="10" r="1"/>'],
  [/^Modulation_/, '<path d="M1 8c2-4.5 4-4.5 6 0s4 4.5 6 0"/><path d="M1 4v8M15 4v8"/>'],

  [/^Discriminator_EnvelopDetector/, '<path d="M1 8c2-5 4.5-5 6.5 0s4.5 5 6.5 0"/><path d="M2 4.2h5" stroke-dasharray="2 2" opacity=".5"/>'],
  [/^Discriminator_Freq/, '<path d="M1 11.5c3.5 0 3.5-7 7-7s3.5 7 7 7"/>'],
  [/^Discriminator_/, '<path d="M1 11.5c3.5 0 3.5-7 7-7s3.5 7 7 7"/>'],

  [/^Draw_Plot/, '<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M3 11l3-4 2.5 2.5L12 5"/>'],
  [/^Draw_PowerSpectrum/, '<path d="M2 13V9M5 13V5M8 13V2M11 13V7M14 13V10"/><path d="M1 13h14"/>'],
  [/^Draw_SignalSpectrum/, '<path d="M3 13V6M8 13V3M13 13V8"/><circle cx="3" cy="6" r="1"/><circle cx="8" cy="3" r="1"/><circle cx="13" cy="8" r="1"/>'],
  [/^Draw_ScatterPlot/, '<path d="M2 2v12h12" opacity=".45"/><circle cx="5" cy="9" r="1.1"/><circle cx="8" cy="5" r="1.1"/><circle cx="11" cy="10" r="1.1"/><circle cx="12" cy="6" r="1.1"/>'],
  [/^Draw_EYEdiagram/, '<path d="M1 8c3-6 11-6 14 0-3 6-11 6-14 0z"/><path d="M8 4.5v7" opacity=".35"/>'],
  [/^Draw_Distribution/, '<path d="M1 12.5c3.5 0 3.5-9 7-9s3.5 9 7 9"/><path d="M1 12.5h14" opacity=".35"/>'],
  [/^Draw_Stairs/, '<path d="M1 12h3V8h3V5h3V2h4"/>'],
  [/^Draw_Stem/, '<path d="M3 13V6M7 13V4M11 13V8M14 13V5"/><circle cx="3" cy="6" r="1"/><circle cx="7" cy="4" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="14" cy="5" r="1"/><path d="M1 13h14"/>'],
  [/^Draw_/, '<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M3 11l3-4 2.5 2.5L12 5"/>'],

  [/^BER/, '<path d="M1 3c4 0 5 9 14 9"/><path d="M1 3v10h14" opacity=".35"/>'],
  [/^ChannalCoding_ConvEncode/, '<path d="M2 3v10M8 3v10M14 3v10"/><path d="M2 5l6 3 6-3M2 11l6-3 6 3"/>'],
  [/^ChannalCoding_ConvDecode/, '<path d="M2 3v10M8 3v10M14 3v10M2 5l6 3 6-3"/><path d="M10.5 11l3 2-3 1"/>'],
  [/^ChannalCoding_HammingEncode/, '<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M6 2v12M10 2v12M2 6h12M2 10h12"/>'],
  [/^ChannalCoding_HammingDecode/, '<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M4 8l2.5 2.5L12 5"/>'],
  [/^ChannalCoding_/, '<rect x="2" y="2" width="12" height="12" rx="1"/><path d="M6 2v12M10 2v12M2 6h12M2 10h12"/>'],

  [/^SourceCoding_PCMCoding/, '<path d="M1 12h3V9h3V6h3V3h4"/><path d="M11 3h3v3" opacity=".4"/>'],
  [/^SourceCoding_PCMDecoding/, '<path d="M1 4h3v3h3v3h3v3h4"/>'],
  [/^SourceCoding_PCMQuantiz/, '<path d="M1 8c2-4 4-4 6 0s4 4 6 0"/><path d="M2 5h12M2 8h12M2 11h12" opacity=".3"/>'],
  [/^SourceCoding_DeltaMCoding/, '<path d="M1 11l2-2 2 2 2-3 2 2 2-4 2 3 2-3"/>'],
  [/^SourceCoding_DeltaMDecoding/, '<path d="M1 12l3-2 3-2 3-2 3-2"/><path d="M1 12h14" opacity=".3"/>'],
  [/^SourceCoding_DeltaMPredict/, '<path d="M1 12l3-2 3-2 3-2 3-2"/><path d="M11 4h3v3" opacity=".5"/>'],
  [/^SourceCoding_/, '<path d="M1 12h3V9h3V6h3V3h4"/>'],

  [/^SigTransfer_Bi2toM/, '<path d="M2 4h4l4 4-4 4H2"/><path d="M10 8h4"/>'],
  [/^SigTransfer_DeMto2/, '<path d="M2 8h4l4-4 4 4-4 4H2"/>'],
  [/^SigTransfer_Fourto2/, '<path d="M2 3h3l3 5-3 5H2"/><path d="M8 8h6"/>'],
  [/^SigTransfer_HexTransform/, '<path d="M8 1.5l5.5 3.2v6.6L8 14.5 2.5 11.3V4.7z"/>'],
  [/^SigTransfer_Hilbert/, '<path d="M1 8c2-4 4-4 6 0s4 4 6 0"/><path d="M1 8c2 4 4 4 6 0s4-4 6 0" stroke-dasharray="2 2"/>'],
  [/^SigTransfer_MultiJudge/, '<path d="M1 8h4l1.5-3 2 6L10 8h5"/><path d="M1 4h14" opacity=".3"/>'],
  [/^SigTransfer_ParalleData/, '<path d="M2 4h3M2 8h3M2 12h3M9 4h5M9 8h5M9 12h5"/>'],
  [/^SigTransfer_PSTransform/, '<path d="M2 4h8M2 8h8M2 12h8"/><path d="M11 8h4"/>'],
  [/^SigTransfer_/, '<path d="M2 8h4l4-4 4 4-4 4H2"/>'],

  [/^Multipath_Fading/, '<path d="M1 10c2 0 2-6 4-6s2 6 4 6 2-3 4-3"/><path d="M1 12c3 0 3-3 5-3" opacity=".4"/>'],
  [/^Multipath_Zero/, '<path d="M1 8h3M12 8h3"/><rect x="4" y="5" width="8" height="6" rx="1"/><path d="M6 8h4M8 6v4"/>'],
  [/^Multipath_/, '<path d="M1 10c2 0 2-6 4-6s2 6 4 6 2-3 4-3"/>'],

  [/^Custom/, '<rect x="4" y="4" width="8" height="8" rx="1"/><path d="M6 1v3M10 1v3M6 12v3M10 12v3M1 6h3M1 10h3M12 6h3M12 10h3"/>'],
];

function deviceIcon(className, cls) {
  let d = '<circle cx="8" cy="8" r="5"/>';
  for (const [re, path] of DEVICE_RULES) {
    if (re.test(className)) { d = path; break; }
  }
  return '<svg class="' + (cls || "picon") + '" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' + d + "</svg>";
}