# Bundled fonts

- `jetbrains-mono.woff2`: JetBrains Mono 2.304, variable weight 100 to 800, subset to Latin, punctuation, arrows, math, box drawing, blocks and braille. SIL Open Font License 1.1, see `JetBrainsMono-OFL.txt`.
- `symbols-nerd.woff2`: Symbols Nerd Font Mono, subset to Powerline (U+E0A0-E0D7), Seti-UI (U+E5FA-E6B7), Devicons (U+E700-E7C5) and Octicons (U+F400-F4A8). See `NerdFontsSymbols-LICENSE.txt`.

Rebuild the subsets with fonttools, for example:

    pyftsubset "JetBrainsMono[wght].ttf" --unicodes="U+0020-007E,U+00A0-024F,U+02C6,U+02DA,U+02DC,U+2000-20CF,U+2100-218F,U+2190-23FF,U+2400-243F,U+2460-24FF,U+2500-25FF,U+2600-27BF,U+2800-28FF,U+FFFD" --flavor=woff2 --layout-features='kern,mark,mkmk,ccmp,locl,zero' --output-file=jetbrains-mono.woff2
    pyftsubset SymbolsNerdFontMono-Regular.ttf --unicodes="U+E0A0-E0D7,U+E5FA-E6B7,U+E700-E7C5,U+F400-F4A8" --flavor=woff2 --output-file=symbols-nerd.woff2
