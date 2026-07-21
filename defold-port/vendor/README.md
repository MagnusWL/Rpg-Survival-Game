# vendor/ — designerens egne motorer, kørt som de kom

Samme regel som web-spillets `vendor/`: filer herinde er designerens
aflevering og køres ordret. Vi retter aldrig i dem — skal noget ændres,
sker det i den kaldende kode eller ved en ny aflevering.

| fil | fra | bruges af |
|---|---|---|
| `vines.lua` | `Raw_Assets/Grafik/Animation skilltree/Pixel skills menu design/handoff-blomst/defold/vines.lua` (byte-identisk kopi) | `main/gui/skilltree.gui_script` — blod-vinerne i skilltræet |

`vines.lua` er render-agnostisk: den simulerer strengene og kalder en
emit-callback pr. blok; hvem der tegner blokkene, bestemmer kalderen.
Kald-rækkefølgen pr. frame er `desired_sync(desired, now)` og derefter
`update(now, dt_ms)` — den rækkefølge er en kontrakt, for motoren læser
sin egen `dt_ms` fra sidste `update`.
