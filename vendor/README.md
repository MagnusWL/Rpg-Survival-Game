# vendor/ — designerens egne motorer, kørt som de kom

Samme regel som web-spillets `vendor/`: filer herinde er designerens
aflevering og køres ordret. Vi retter aldrig i dem — skal noget ændres,
sker det i den kaldende kode eller ved en ny aflevering.

| fil | fra | bruges af |
|---|---|---|
| `vines.lua` | `Raw_Assets/Grafik/Animation skilltree/Pixel skills menu design/handoff-blomst/defold/vines.lua` (byte-identisk kopi) | `main/gui/skilltree.gui_script` — blod-vinerne i skilltræet |
| `rescue-tear/` | `Raw_Assets/Grafik/Menu/Mobile game menu buttons3/dropin/` | `tools/record-tear.html` — motoren der TEGNER rivningsfilmen |
| `intro-campfire/`, `intro-monster/`, `intro-fog/` | `Raw_Assets/Grafik/Intro/{1 Campfire,2 Monster,3 Horizon}/` | `tools/record-intro.html` — bålet, øjnene og tågen |
| `cranium-coin-bag/` | `Raw_Assets/Grafik/Animation coinbag/Cranium-Coin-bag/` | intet endnu — møntsækken venter på sin plads i porten |

**De fem browser-kits blev reddet tilbage 23. juli 2026**, da web-projektet
forlod git. De er ikke fortid: de er *kameraerne*. Skal rivningen eller
intro-effekterne bages om — for eksempel til liggende format — er det disse
motorer, harness-siderne i `tools/` kører for at tegne billederne. Uden dem
kan filmene ikke laves om, kun bruges som de er.

`vines.lua` er render-agnostisk: den simulerer strengene og kalder en
emit-callback pr. blok; hvem der tegner blokkene, bestemmer kalderen.
Kald-rækkefølgen pr. frame er `desired_sync(desired, now)` og derefter
`update(now, dt_ms)` — den rækkefølge er en kontrakt, for motoren læser
sin egen `dt_ms` fra sidste `update`.
