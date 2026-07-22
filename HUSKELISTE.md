# Huskeliste — ting vi har skubbet til side

Alt herunder er ikke glemt, men heller ikke færdigt. Filen er kun til os to.

Sidst gennemgået 21. juli 2026, aften — ved indgangen til Defold-æraen.

> **23. juli, morgen — MAGNUS'S NATTEOMLÆGNING (10 commits):** Spillet er nu
> **LIGGENDE (844×390)**. Web-projektet er fjernet fra git og `defold-port/`
> flyttet til RODEN — `game.project` ligger nu i projektroden, og Defold
> åbnes med DEN. Items-system + nye skills-priser er hans. ALLE vores
> systemer overlevede i koden (blomst/opvågning, rivning, intro-fx,
> shockwave, bane-knap) — men de er BYGGET TIL PORTRÆT: rivningsfilmen,
> intro-kortene og shockwave-skalaen (SCREEN_H nu 390) skal ses efter i
> landskab. Stier og portræt-tal i afsnittene herunder er fra FØR
> omlægningen — opdateres efter dagens F5. Editor-state fra før ligger i
> stash: "defold editor-state foer Magnus-pull 23. juli".

---

## I GANG LIGE NU: skilltræ-blomsten (afventer F5)

Nicolais handoff (`Raw_Assets/Grafik/Animation skilltree/Pixel skills menu
design/handoff-blomst/`) er syet ind som portens nye skilltree-skærm —
**designets look og motor, spillets rigtige regler og tal.**

**Nøglefund:** designets tre gratis start-skills ER spillets tre rødder med
nye navne — beskrivelserne matcher ordret. Navnemapping (i FLOWER-tabellen i
skilltree.gui_script, ét sted at rette):
ranged→**Air Blade** (airblade), cone→**Judgement** (judgement),
summon→**Ancestor** (ancestor); børnene beholder spilnavne med lånte ikoner:
fireball→meteor, burn→hellfire, push→shieldcharge, summonregen→bloodpact,
cdreduce/Haste→whirlwind, pierce→impale. Interne id'er urørte (gemte
skill_levels virker stadig). Reserve-ikoner (bonewall, chain, plague,
gravevortex, frostnova, doom, nightswarm, raisedead, soulharvest, ricochet,
cleave) ligger med i atlasset til fremtidens skills.

**Hvad der er bygget:**
- `defold-port/vendor/vines.lua` — designerens blod-vine-motor, byte-identisk
  kopi (vendor-reglen). Kald-kontrakt: `desired_sync` FØR `update` hver frame.
- `defold-port/main/tiles/skilltree.atlas` (23 ikoner 128×128) +
  `skilltree_bg.atlas` (jordtegningen) + kopier under
  `defold-port/assets/sprites/skilltree/`.
- `skilltree.gui_script` totalt omskrevet: Awakening-kerne i midten (tap =
  unfurl-ritualet, hver gang man går ind), rødderne som indre stjerne (0.6×),
  børnene på ydre ring (1.0×, flankerer forælderen ±35°), niveau 2-4 som
  kædede rang-bælge (130/245/360 ud ad strålen). Vines under bælgene, pool
  på 2600 box-nodes, blokstørrelse følger SKÆRMEN (2 px / kamera-skala) så
  antallet er bundet. Kamera-fit på synlige noder, OUTQUAD 0.5 s.
- Købs-/equip-reglerne er de GAMLE (gold, forældre-gate, niveaupriser
  5/10/15/20, 3 aktive + 1 passiv) — kun omsagt med flash-beskeder.
  Tap-flow som designet: ukøbt→køb, købt→udfold gren, udfoldet→equip.
  Chevron øverst = tilbage til menu; tap på jorden = fold grene sammen.
- `game.project`: NEAREST-filter globalt (designerens README-krav for skarpe
  ikoner) — **rammer HELE spillets sprites**, se F5-punkt 3.
- Bevis uden Defold: Lua-syntaks parset OK; vine-motoren kørt 570 frames i
  Lua-VM med blomstens præcise strenge — 21/21 strenge fuldvoksede, visning
  og fast-regrow virker, max 1909 blokke < 2600-loftet.

**Vokse-logikken rettet efter Nicolais øjne (22. juli, anden runde):** første
udgave viste alle 9 skills fra start (børn grå/låst) med vines fra rod til
barn — MIN kobling, ikke designets. Nu blomstrer træet i BØLGER fra kernen
som i standalone'en: unfurl viser kun de tre rødder; et barn er USYNLIGT
til forælderen er købt og skyder så ud fra midten (designets opvågnings-
teater). ALLE vines udgår fra kernen — forældre-båndet bestemmer HVORNÅR
et barn spirer, ikke HVOR strengen kommer fra. Kameraet refitter ved hvert
køb. Reglerne (priser, gates, equip) stadig Magnus's, urørte. Vil Nicolai
en dag have designets GULD-opvågninger (800/1600 g i kernen), er det en
gameplay-ændring → Magnus-snak. NB: goto findes ikke i Lua 5.1 (HTML5-
builds) — brug if, ikke goto continue.

**Tredje runde (22. juli, efter "det føltes meget bedre"): kernen ER
opvågningen nu, som i standalone'en.** Tryk 1 = de tre rødder, tryk 2 =
SECOND AWAKENING (de tre aktive børn: Fireball/Burn/Push), tryk 3 = THIRD
AWAKENING (de tre passive). self.awakening (0-3) erstatter revealed; hver
bølge lander som en 120°-stjerne (flanke-vinklerne gav to perfekte
trekanter). Trykkene er GRATIS — html'ens 800/1600 g på opvågning II/III
er gameplay → Magnus-snak, står stadig åben. Et barn kan derfor stå i
stjernen FØR dets rod er købt: det står dæmpet, køb flasher UNLOCK X FIRST
(spillets forældre-gate urørt).

**MANGLER (F5-test):**
1. Menu → Skills: tap kernen tre gange → rødder, aktive, passive i bølger.
2. Køb/equip-runde: køb rod (5g), udfold, køb Rank II-IV, equip/unequip —
   glød, visnende vines ved unequip, flydende genvækst ved re-equip.
3. NEAREST-filteret: kig på SPILLET (ridder, zombier, menu-cover, intro) —
   ser noget hårdt/forkert ud, fjernes [graphics]-blokken i game.project
   (én blok, ren revert).
4. Navnelæsbarhed: skilt-tekster er designets størrelser og kan være små på
   fuld udzoomning — sig til, så skruer vi op.
5. Lyd mangler helt i skærmen (køb-klik? equip-lyd? vine-hvisken?) — Nicolais
   afdeling, pladsen er klar.

**Åbent efter design:** slot-tap i bunden gør ingenting (designets zoomTo var
udefineret i prototypen); beskrivelses-tekster fra den gamle liste vises ikke
(designet har ingen plads til dem — de findes stadig i skills.lua).
Web-udgaven af blomsten er IKKE bygget (Defold-æraen først).

**AFGØRELSE (Nicolai, 22. juli) — til Magnus:** standalone-HTML'en i din
`feature/new-skill-tree`-gren (hovedudgaven) er det GAMLE design. Blomsten
her i Defold-porten er det nyeste og det rigtige — grafik, animation og
vokse-logik er kanon som den står. Dine REGLER er velkomne ovenpå: priser,
gates, økonomi (fx guld på opvågning II/III — pladsen er klar i koden).
Kort sagt: tallene dine, blomsten vores.

---

## Shockwave på Rupture: jorden selv slår bølge (22. juli, afventer F5)

Ny handoff-TYPE: ikke en motor der køres, men **shader-matematik der
genskabes præcist** (README'en: "the GLSL translates 1:1... should be
reproduced exactly"). Første custom material i porten.

- `materials/ground_shockwave.{material,vp,fp}` — fragment-shaderen
  forskyder jordteksturens UV'er radialt når bølgefronten passerer +
  lysglans på kammen. Matematikken er handoffens GLSL ordret; kun rummet
  er anderledes (verdens-pixels i stedet for skærmhøjde-enheder, uv_k
  konverterer til sidst). Gammel GLSL-dialekt (attribute/varying) — mest
  versionssikre på tværs af Defold-udgaver.
- **Arbejdsdeling som README'en kræver:** udseende-tallene ordret fra
  handoffen (amplitude 59, fart 1400, bredde 120, ripples 0,7, henfald
  1,15, glans 0,13 — alle ÷1080 ref-højde, skaleret med vores 844);
  GEOMETRI fra spillet: origin/sigte/øjeblik = cone-zonens (affyres i
  sync_zones når telegrafen fødes, billede 12), keglevinkel =
  ABILITY2_HALF_ANGLE_DEG (21°, ikke designets 27,5°), range = CONE_RANGE.
  Sjovt sammenfald: designerens 1400/1080-fart ≈ 1094 px/s hos os ≈
  spillets skadebølge på 1100 — de har tunet mod det rigtige spil.
- 8 bølge-slots som navngivne constants (wave0_a..wave7_b — arrays i
  materials er nyere API, fravalgt for versionssikkerhed). Klokken er
  SIM-tiden (pause fryser jorden). Slots nulstilles ved run-start/-slut.
- Baggrunden FLYTTET fra world.atlas til eget world_bg.atlas (forskudte
  UV'er må ikke kunne trække glow/prims ind i jorden; world.atlas
  beholder glow+prims til mob/ally/glow). Begge baner bærer materialet —
  bane1-atlasset var allerede sit eget. Teksturstørrelser spørges ved
  runtime (resource.get_texture_info, 2048-fallback).
- **Kendte kanter:** (1) øverste/nederste spillefelt-rækker kan suge sort
  ind ved kraftig kam — HUD-bjælkerne dækker formentlig sømmen; kig efter.
  (2) Tuning-knapper til Nicolai: WAVE_PARAMS_A/DECAY/SHADING øverst i
  world.scripts shockwave-blok.

**F5:** kast Rupture — jorden skal SKUBBES udad i keglen samtidig med
strejf-linjerne, én ren puls (ripples 0,7), død ved damage-rækkevidden.
Prøv også på den nye bane (settings-knappen) — materialet sidder på begge.

---

## Ny bane-baggrund bag test-knap (22. juli — Nicolai: "ser godt ud")

`Raw_Assets/Grafik/Baner/Bane 1.png` (2400×1792, i virkeligheden en JPEG med
png-navn) er møllet til `defold-port/assets/sprites/bane1.jpg` i den gamle
banes PRÆCISE mål (1448×1086, cover-beskåret — formatet var næsten ens, så
beskæringen koster ~2 % i bredden). Derfor er AL geometri fælles: samme
cover-skala, samme pyt-/regn-matematik, world.script kender kun ét sæt tal.

- To sprites på background.go (`bg`/`bg_bane1`) — de to malerier kan ikke dele
  én 2048-tekstur; skiftet er enable/disable som ridderens animationer.
- Settings-række **"New arena (test)"** — session.bane1_bg, IKKE gemt
  (nulstilles ved genstart, som Weather). Virker også fra menuens settings.
- **Kendt hak:** pyt-kortet (puddles.lua, brøker af det GAMLE billede) styrer
  våde skridt og ringe — på den nye bane kan sprøjt lande på tørre sten.
  Den nye bane HAR selv vand, så det mudrer mildt. Vælges banen til, skal
  Nicolai udpege pytterne, og puddles.lua får et sæt pr. bane.
- Dobbelt-mølle-løftet stadig ubygget MED VILJE: web-spillet har ingen
  test-knap, så denne aflevering havde intet web-behov. Møllen bygges når
  et asset reelt skal til begge verdener.

---

## RESCUE HER-rivningen ind i Defold (syet, afventer F5)

Nicolais spørgsmål "er et spritesheet ikke bedre end en film?" er allerede
svaret: **optagelsen ER et spritesheet.** Motoren tegner billederne én gang
(det er "filmen"), og resultatet er `tear.atlas` — 20 billeder, spillet som
ethvert andet ark. Ingen video findes.

**Gjort og virker:**
- `tools/record-server.mjs` — optage-studiets server (statisk + POST /frame).
  Startes: `node tools/record-server.mjs`, kør siden på `localhost:8123`.
- `tools/record-tear.html` — kører kittets motor på **virtuel tid**
  (performance.now, Date.now OG rAF udskiftet før konstruktion → deterministisk
  og immun over for rude-frysning). Geometri = portens egne brøker på 390×844.
  42 billeder @ 30 fps optaget til `tools/recordings/tear/` (ignoreret, kan
  genskabes).
- `tools/pack-tear.mjs` — fælles kasse over alle billeder (390×413 @ (0,431)),
  vælger billedtal efter 2048-teksturloftet: **20 billeder @ 15 fps** (stride
  2, 2 halebilleder ofret — settle-posen), 12,3 MB udpakket. Skriver
  `defold-port/assets/sprites/tear/tear-XX.png` + `placement.json` +
  `defold-port/main/tiles/tear.atlas` (animation "tear",
  PLAYBACK_ONCE_FORWARD).

**Syet ind (22. juli): menu.gui har tear-atlasset som texture, menu.gui_script
bygger den skjulte tear-node (centrum (195.0, 206.5), 390×413 — direkte fra
placement.json-tallene i TEAR_BOX) og plaque-trykket skjuler plaquen, spiller
flipbogen og starter runnet i slut-callbacken. `self.tearing` sluger al input
imens. Vigtig detalje fundet i main.script: menuen genstartes IKKE ved
hjemkomst fra et run (kun enable/disable) — derfor stiller slut-callbacken
plaquen tilbage og skjuler filmen FØR start_new_run, i samme frame som
skærmskiftet skjuler menuen. Continue/Test run starter stadig straks.
Lyd (rettet 22. juli efter Nicolais øre): de fire menu-press-dele slås an
VED TRYKKET som webbens leaveMenu gør — klikket flyttet ud af start_new_run
(main.script, én linje, animationsbegrundet). Vil Nicolai have en riv-lyd
oveni, leverer han én.**

**MANGLER:**
1. Nicolai F5-tester: rivning → spilstart når filmen er færdig (~1,3 s).
   Se efter: sømløst skifte plaque→film (billede 0 er den intakte plaque),
   stumperne falder hen over link-rækken, plaquen er tilbage næste gang
   menuen ses.
2. Er 15 fps for hakket i snappet, er alternativet halv opløsning @ 30 fps
   (~6,8 MB) — én linje i pack-tear (resize før crop) + ny pakning.

**Genbrug:** samme studie (server + virtuel-tid-harness + pakker) er skabelonen
for CRUEL-glimtet (intro-effekterne er GJORT, se næste afsnit).

---

## Intro-effekterne bagt ind i Defold (22. juli, afventer F5)

Bål, øjne og tåge er filmet som **loops** i studiet (`tools/record-intro.html`
+ `tools/pack-intro.mjs`) og syet ind i portens intro. Billede 3 fik webbens
Ken Burns tilbage: scale 1,2→1,26, glid −70→+70, LINEÆRT over 5,6 s.

**Loop-lærdommen (andre regler end rivningen!):**
- Loops ofrer OPLØSNING, aldrig billeder — perioden er designet. Pakkerens
  faktor-stige (1,0→0,35) + stride-valg (kun hele eksponerings-spring, ægte
  sim-tid imellem) finder skarpeste film der kan ligge på ÉN 2048-tekstur.
- Bålet: glød-pulsen er to sinuser i 5:2 → eksakt periode 4021,24 ms —
  filmet præcis én periode, sømmen ER kontinuitet. 50 billeder @ 12 fps,
  faktor 0,7, 10,6 MB.
- Øjnene: ren sinus-flet uden kort periode → harnesset SØGER klippepunktet
  hvor kurven møder sig selv (fandt E=0,0003 ved t=26,8 s) + 4 billeders
  krydsfade. 131 billeder @ 15 fps, fuld opløsning, 8,4 MB.
- Tågen: aperiodisk støj → 10 billeders krydsfade mod halen
  (out[i]=lerp(rec[N+i], rec[i], (i+1)/(cf+1))). 60 billeder @ 10 fps,
  halv opløsning, 10,3 MB.
- Motor-fælde: kittenes loop() klemmer dt til 50 ms — større virtuelle skridt
  gør simulationen LANGSOMMERE end designet. Kuren: kræng motoren i ≤50 ms
  bidder mellem eksponeringerne (tågen: 2×50 ms pr. billede; bålet: stride 2
  over en 40 ms-optagelse).
- Defold-fælde: GUI-noder kan IKKE skifte blend-mode fra Lua — ADD-noderne
  (bål+øjne ≈ webbens screen-blend) klones fra `fx_add`-skabelonen i
  menu.gui. Tågen er normal alpha.
- Effekt-noder er BØRN af deres kort med inherit_alpha → de fader, rejser
  og dør med kortet (webbens egen løsning). Placering fra
  `introfx/*-placement.json`, hårdkodet i INTROFX-tabellen i menu.gui_script.

**F5-kig:** (1) bålet ånder på billede 1 (glød-loop uden hak hvert 4. sekund?),
(2) øjnene gløder og pulserer på billede 2 (søm usynlig hvert 8,7 s?),
(3) tågen driver på billede 3 MENS kameraet skubber ind og stiger,
(4) ADD-blend mod screen: er bål/øjne for lyse, er alternativet at bage
kortet+effekt sammen fladt (mister Ken Burns-frihed) eller dæmpe alpha.
(5) Opløsning: bål faktor 0,7 / tåge 0,5 — for blødt? Sig til.

**Det lovede dobbelt-leverings-workflow** (møllerne skriver til både
`assets/` og `defold-port/assets/` + komponentfiler i ét hug) er stadig
**ubygget** — bygges første gang Nicolai afleverer nyt råmateriale, mod det
ægte behov. Rivningen her var første skridt: den skriver allerede direkte
til defold-port.

---

## KORTET: hvor tingene bor nu (21. juli, aften)

**Grene:**
- `master` — Magnus's. Web-spillet ("source of truth for behavior") +
  **`defold-port/`**, hans komplette native Defold-port.
- `feature/defold-assets` — **VORES gren nu**: grafik, sprites, lyd, musik,
  animation i Defold-æraen. Skåret af master.
- `feature/knight-sprites` — web-æraens gren, færdig og fuldt pushet. Bærer
  Atlas-pakningen (de beskårne ark), som master ALDRIG fik. Fryses som arkiv.

**Sprite-ark, tre hjem — og én jernregel:**
- `Raw_Assets/` — **menneskets indbakke** (Nicolai, 21. juli): al rå kunst,
  lyd og musik i `Grafik/`, `Lyde/` og `Music/` under ét git-ignoreret tag.
  Røres aldrig af møllerne, kun læses. Ubrugt råmateriale arkiveres i
  `Raw_Assets/Grafik/arkiv/` osv. — inden for ignore-hegnet.
- `assets/sprites/` — web-spillets ark. På denne gren: **almindelige
  128-gitre** (upakkede).
- `defold-port/assets/sprites/` — portens **egne kopier**, almindelige
  128-gitre. **Defolds tile sources kræver faste 128-celler — giv den
  ALDRIG pakkede ark.** Pakning i Defold = Magnus's teksturkomprimering.
- `defold-port/vendor/` — designerens motorer i Defold-æraen, ordret
  (lige nu: vines.lua fra skilltræ-handoff'en). Samme regel som web'ens
  vendor/: vi retter aldrig i dem.

**Arkivet:** `arkiv/` i roden (sporet, med README der logger hvad/hvornår/
hvorfor) til udgåede kode-ting; `arkiv/lokalt/` (ignoreret) til lokale
testfiler; `Grafik/arkiv/` til råkunst. **Intet slettes.**

**Defold-editoren:** `Downloads\Defold-x86_64-win32\Defold\Defold.exe` —
åbn `defold-port/game.project`, tryk F5. Konsollen skal vise
`PORT TESTS: N passed, 0 failed`.

Bemærk: afsnittene herunder er skrevet i web-æraen. Tallene og
beslutningerne gælder stadig (de ER porterings-specifikationen), men
"i spillet nu" betyder web-udgaven — Defold-portens tilstand skal
efterprøves punkt for punkt, efterhånden som vi tester den.

---

## Slukket, men ligger klar

**Møntsæk-sliders** — `DEBUG_COINSACK_TUNING` i `App.tsx` (~linje 757).
Sæt til `true`, så kommer panelet med placering, bredde og "smid en mønt" tilbage.
Tallene den fandt frem til står allerede i `COINSACK_LEFT` / `_BOTTOM` / `_WIDTH`.

**Rim light-sliders** — `DEBUG_RIM_TUNING` i `App.tsx` (~linje 357).
Sæt til `true` for farve, styrke og blandingsmåde på ridderens månekant.
Værdierne står i `RIM_STYLE` lige over.

Begge paneler deler `DebugSlider` og `tunePanel`-stilarterne. De koster intet
når de er slukket — de bliver slet ikke tegnet.

---

## Midlertidigt synligt i spillet

**Musik og regnlyd starter SLUKKET** (21. juli, Nicolais ønske mens vi tester
animationer). `useState(true)` på `musicOff` i App.tsx — **skal tilbage til
`false` inden PR'en.** Samtidig følger regnens ambience nu musik-kontakten i
stedet for kun master-kontakten, og rækken hedder derfor "Music & rain";
vejr-kontakten er med vilje holdt udenfor, så man kan få stilhed med regn
stadig faldende. Den kobling er ikke midlertidig — kun default'en er.

**"Continue · Test run"** nederst i menuen. Designet har én knap, og de to her
er parkeret nede i hjørnet med lille skrift indtil det er afgjort hvor de hører
hjemme.

**Ordet `LOGO`** i introen er ren tekst i plakatens blodrøde. Den venter på
rigtig logografik — ét sted at skifte, i `IntroSequence.tsx`.

---

## Virker kun i browseren

Møntsækken, RESCUE HER-knappens tear-effekt og de tre intro-effekter (ild, øjne,
tåge) er alle canvas. React Native har ikke canvas, så **på en telefon tegner de
ingenting**.

Historiebillederne vises stadig — de står bare stille. Menuknappen falder tilbage
til et almindeligt billede. Møntsækken forsvinder helt.

Det mest sandsynlige svar er en WebView. Hver effekt er én selvstændig fil, så
det er det eneste sted der skal ændres. Det er ikke noget vi skal beslutte i
forbifarten.

---

## Kræver genbygning, ikke en slider

**Rim light: retning og rækkevidde.** `toLight` og `band` i `RIM` øverst i
`tools/build-sprites.mjs`. Farve og styrke kan skrues live; disse to er selve
formen på lyset og regnes ud når arkene bygges. Kør `npm run build:sprites`
bagefter — det tager få sekunder.

---

## Fra menu-manualen mangler den ene af to

`Grafik/Menu/Mobile game menu buttons3/MANUAL-effekter.md` beder om to ting.

- **Effekt 2 — glimt hen over CRUEL:** ✅ inde, og motorens kode er linje for
  linje den samme som manualens.
- **Effekt 1 — knappen skal svæve og gløde i hvile:** ❌ ikke lavet. Det er ren
  CSS i manualen, men vores knap er et canvas, så den skal løses lidt anderledes.
  Manualen advarer selv om at svævet kan kollidere med tear-animationen.

---

## Kampfølelsen: flinch → spark (bygget 20. juli, aften — plan A)

Nicolais sekvens er inde: rammes han mellem sving, flincher han, og hvis
nogen stadig står inden for 70 px i en 120°-vifte foran ham, **sparker han
dem væk** — skubbet der før red usynligt på det skjulte sving, leveres nu af
sparket (frame 6, hvor benet er ude). Bevægelse afbryder sparket, og et
afbrudt spark skubber ingen. Skadestal er urørte — kun skub og animation.

Sparket kommer kun **halvdelen af gangene** (ét møntkast i det øjeblik
flinchen slutter — Nicolais valg, 20. juli). Taber mønten, rejser han sig
bare, og ingen bliver skubbet den gang: skubbet bor på sparket, så uden
spark intet skub. Sparket gør ingen skade nogensinde — skaden faldt
allerede med svinget.

**Ikke set i drift endnu:** forhåndsvisningen frøs under alle forsøg, så
sekvensen hurt→kick er bevist i logik og typecheck, ikke med øjne. Nicolai
tester ved at stille sig i en flok.

Lyden kom 20. juli (aften): Nicolais to spark-optagelser er inde som
`kick-1`/`kick-2` — gennem lydmøllen som alt andet, så deres meget høje
niveau er lagt på husets (snittet lander lige under sværdsvingene, så de
burde passe ind uden videre). Klippet vælges tilfældigt, startes tidligt
med sit eget målte optræk så fuld styrke rammer kontakt-frame 6, og det
tier hvis sparket afbrydes af bevægelse. **Skal de dæmpes/hæves:** giv
kick-linjerne et `level` i `tools/sound-config.mjs` og kør
`npm run build:sounds`.

**Åbent stadig:**
- Plan B fra diskussionen (skaden venter også på sparket) er stadig kun en
  tanke — det er balancearbejde og skal over Magnus's bord.
- Kontaktframe (6), rækkevidde (70), vifte (120°) og chancen (50%,
  `KICK_CHANCE`) er førstegæt til Nicolais øjne.

---

## Tre nye ridder-animationer (20. juli, nat)

**Die — faldet.** Spillet frøs før i samme sekund som det dræbende slag; nu
får faldet sin scenetid: marken simulerer videre, mens han går ned (14 fps
plus 0,45 s hvil på sidste billede, ~1,5 s i alt), og først derefter kommer
game over-skærmen. Guld, gemmer og skærmen selv er urørte — de venter bare
på faldet. Mens han falder: ingen ordrer, ingen sving, ingen regeneration.
Slaget, der fældede ham, høres stadig.

**Rupture (Special1) ved Cone** og **Ancestor (Special2) ved Summon** —
Nicolais navne på kastene. Posen spilles i det øjeblik, skillen fyres af;
selve skillens virkning er præcis som før (Magnus's kode — kun ét mærket
linjepar pr. sted). Kastes der i løb, springes posen over, og bevægelse
afbryder den — samme regel som sparket.

**Førstegæt til Nicolais øjne:** die 14 fps + 0,45 s hvil; begge kast 18 fps.
Ruptures koreografi står **skrevet helt ud** i `order` på `ANIMS.rupture`,
og den nuværende liste er **Nicolais egen** — han skrev den selv i
trin-notationen (20. juli): åndedrag 0,3 s på billede 7, tre sving
12↔13, frysning 0,5 s på 13, hale — 1,86 s i alt. Hvert trin i listen er
ét vist billede og kan bære sin egen pause; `order` findes på enhver
animation og trumfer `passes`/`holds`.

**Cone-zonen tegnes nu** (`CONE_ZONE` i App.tsx). Første forsøg var
flyvende splinter — Nicolais dom: *"bare en bunke store pixels der blæser
op"*. Det han ville have, var **selve angrebszonen synliggjort** med et
tæppe af små pixels. Version 2 gør det: keglens to kanter tegnes som
ubrudte pixel-streger, og indenfor ligger en dither, der er tættest ved
støvlerne og tynder ud — tændt udefter som en lunte (1500 px/s, hele
vejen på ~0,53 s), holdt, og opløst over 0,7 s. I alt 2 sekunder.

Hvorfor kanter: zonen er *enorm* (42° × hele banen), og et jævnt tæppe
ville koste 800+ pixels eller læse som støv. En optegnet kant koster kun
længde — ikke areal.

**Pixelstørrelsen halveret til 4 px** (Nicolai, 21. juli). Halvering
firedobler kandidaterne, så fyldets tæthed blev skruet tilsvarende ned —
finere korn, ikke firedobbelt pris: værste simulerede tilfælde 599 mod
loftet 600 (mod 374/426 ved 8 px). Kanten beholdt sin tykkelse; den
bærer formen.

**Zonen venter nu på billede 13** i Ruptures koreografi — 967 ms efter
kastet (Nicolai, 21. juli). Ventetiden er ikke skrevet som et tal men
*regnet ud af koreografien* (`frameStartTime(ANIMS.rupture, 12)`), så
den flytter sig selv, hvis `order` skrives om. Det er en timer, ikke en
vagt på selve animationen — så et kast i løb, hvor posen springes over,
stadig oplyser jorden. **Ikke set med øjne endnu:** ruden frøs (1 fps,
cooldown løb aldrig ud), så 589 pixels à 4 px og de 967 ms er målt/
udregnet, ikke beskuet. 8-px-udgaven var derimod set og målt: dom
449→816, 220 fps, hak 0.

Gitteret er skærmens, ikke kastets — pixels ville blive til skæve rudere,
hvis tæppet blev roteret på plads. Testen for hver pixel er *keglens egen*
(rækkevidde + halvvinkel), altså samme spørgsmål som skaden stiller, så
det der lyser op, er det der rammes. Ren dekoration — skaden var og er
øjeblikkelig.

**Stadionbølgen = slaget** (Nicolai, 21. juli, tredje omgang). Pixlerne
ligger nu på **buer** med 36 px mellemrum i stedet for spredt tilfældigt.
Fronten er selv en ring af konstant afstand, så den rammer en hel bue på
samme øjeblik og tænder den som **én streg**, der derefter rejser udad —
det er dén, man skal forstå slår. Stregen er stiplet (halvdelen af buens
pixels): en massiv streg koster det dobbelte og læser ikke bedre.

En pixels liv, i én animation (1,5 s): fronten rammer → den blusser op og
svulmer til 2,4× → springer 8–28 px → falder → lille efterhop → **dæmpes
til ca. halv styrke** (så den lysende streg er fronten alene, og alt bag
den er gløder) → **driver langsomt 16 px opad og toner ud**.

Tre ting følger gratis af, at drift og udtoning bor på pixlen selv i
stedet for på laget: zonen **toner ud fra spidsen og udad**, fordi de
nære pixels begyndte først; der er ingen fælles udtoning, der får det
hele til at forsvinde som et lagen; og bølgen behøver ingen ekstra
elementer.

Første forsøg var **dødt, og regnestykket forklarer hvorfor:** 5 px hop
delt i 8 trin = 0,6 px ad gangen, mindre end én pixel — ingen bevægelse
overhovedet. Alle løft er nu hele multipla af pixlen i 4 trin.

**Hakket i den opadgående drift var ikke tunghed** — det var mit valg af
4 trin, som over et helt sekund blev til ét ryk hvert kvarte sekund.
Nicolai så det med det samme og troede det var lag. Løst med en
tidsfunktion *inde i* nøglebilledet ved 34% (`animationTimingFunction:
'linear'`), som kun styrer intervallet derfra: springet beholder sit
hak, stigningen glider. Verificeret i den kompilerede regel — RNW
sender per-keyframe timing igennem.

**Pixlen halveret igen til 2 px** (21. juli) — en tyvendedel af ridderens
bredde. Buerne blev tilsvarende færre (52 px) og tyndere (0,4), kant og
dither skruet ned; 672 pixels i simuleringen, stregen vokser 8 → 88.

Kanten er **tonet ned** (tæthed 0,55, alfa ~0,3) — buerne har overtaget
jobbet med at vise formen.

**Skaden rider nu på bølgen** (`CONE_DAMAGE_RIDES_WAVE`, Nicolais
udtrykkelige ja 21. juli — den ENE gameplay-ændring i hele effekten).
Zombierne tager først skade og blinker rødt, når stregen når dem: 1,0 s
for en helt tæt på, 1,3 s på 400 px, op til 1,7 s yderst. **Tallene er
Magnus's urørte** — `fireCone` afgør stadig hvem der rammes og hvor
hårdt, i kastets øjeblik; den bliver bare kaldt for sit sigte og sin
udregning, og dens færdigskadede liste kasseres bevidst. Målene er
**låst ved kastet** (går en zombie ud af keglen, rammes den alligevel —
du sigtede der), og en ventende træffer på en allerede død springes over.
Leveringen sker lige før brand-kæden, så et drab her tæller som ethvert
andet drab samme frame. **Rul tilbage:** sæt flaget til `false`, så
lander alt igen på trykket.

Bemærk: keglen gav **slet ikke rødt blink før** — `fireCone` trak bare
liv fra. Blinket er altså ny gevinst, ikke noget vi har flyttet.

**Drejeknapper i `CONE_ZONE`:** `cell` (pixelstørrelse), `arcGap`/
`arcDensity` (stregernes afstand og stiplethed), `edgeBand`/`edgeDensity`
(kantens tykkelse/tæthed), `fillNear`/`fillFar`/`fillFalloff` (ditheren
mellem stregerne), `sweepSpeed` (bølgens fart), `cellLifeMs` (en pixels
levetid), `drift` (hvor langt den driver op), `hopSteps` (hakketheden),
`CONE_HOPS` (de seks spring), farverne, og `maxCells` (loftet — 640;
værste simulerede tilfælde 640). Hele kastets levetid regnes ud af
farten og levetiden (`CONE_ZONE_MS`), så intet klippes midt i driften.

Keglens facit i øvrigt: vinklen er 42° (2×21), rækkevidden hele banens
diagonal (~765 px) — skaden når altid forbi skærmkanten. Sigte-trekanten
(`renderCone`/`aimingAbility`) er stadig **død kode** — intet starter
sigtet; formentlig bænket da kvik-kast-bjælken kom. Skal over Magnus's
bord, hvis sigtet skal genoplives eller ryddes op.

Ancestor spiller **frem → tilbage → frem igen** (`passes` på `ANIMS.ancestor`,
Nicolais figur, 20. juli) og ender stående på sidste billede — 2,4 s i alt.
Vendepunkterne deler billede, så den drejer i stedet for at hakke. `holds` og
`passes` kan kombineres frit, også på andre animationer.

**ShieldBlockMid er IKKE bygget** — Nicolai: den skal trigge under et bestemt
item, grenen findes senere. Kilden ligger klar i `Grafik/Knight`; den føjes
til `SHEETS` i `tools/build-sprites.mjs`, når den får sin krog (et bygget
ark er monteret altid og koster hukommelse, så den venter med vilje).

---

## Zombien falder også (20. juli, nat)

ZombieMale2's to dødsanimationer (`Die`/`Die2`) er inde som et **rent visuelt
lig-lag**: fjenden forlader spillets lister i præcis samme frame som før —
loot, guld, bølge-tælling, sigte og spark-viften er urørte — men kroppen
bliver liggende, hvor den faldt: fald (14 fps, ~1,1 s), hvile (1,4 s), og
0,6 s udtoning. Tilfældigt valg af de to pr. død, så en mejet flok ikke
falder i takt. Kun nærkamps-zombien — cirklerne (ranged/boss) forsvinder
stadig bare, for de har ingen krop at falde med. Ligene deltager i
dybde-sorteringen, så levende går foran dem, og de ældes på simulationens
ur (pause fryser dem midt i faldet). Tal til øjnene: `CORPSE_LINGER` /
`CORPSE_FADE` i `App.tsx` + fps i `MOB_DIE_ANIMS`.

---

## Defold-flytningen (Magnus er i gang — plan, intet gjort)

Nicolai nævnte 21. juli, at Magnus er ved at flytte spillet til **Defold**.
Kunsten, lydene og alle design-tal overlever; kun web-rørføringen skiftes ud.
Denne liste er reelt porterings-specifikationen. Fordelingen, når dagen kommer:

**Bages til flipbøger** (kittene kører én gang i web-udgaven, billederne
optages og pakkes — designerens motor tegner selv sine frames):
- RESCUE HER-rivningen (én forestilling, ~20-30 billeder)
- Intro-effekterne: bål, øjne, tåge (loops, beskåret til deres områder)
- CRUEL-glimtet (eller genskabes trivielt)

**Genopbygges** (interaktivt/levende — kan ikke filmes):
- Kraniet: Defolds indbyggede Box2D-fysik + kittets kunst, lyde og tal
- Regn + vandringe: Defolds partikelsystem; vores tal er opskriften

**Flytter som de er:** alle sprite-ark, kegle-stregerne (allerede en flipbog),
alle lyde. Koreografierne (`order`-lister) er Defolds *native* animationsform.

**Motor-råd der først gælder i Defold:** mipmaps FRA på pixel art;
ASTC/ETC2-komprimering på baggrunde men test sprites med øjne (4×4-blokke
kan smøre skarpe kanter).

**Venter på:** Magnus's bekræftelse + tidshorisont. Derefter bygger Claude
optage-værktøjet (en side der kører hvert kit og gemmer canvas-billeder).

**Rundturen er testet** (21. juli): Magnus kørte `Melee.png` gennem Defold, og
udgaven er **pixel-identisk** med kilden — 0 afvigelser af 7,9 mio. px, ingen
resampling, ingen premultiply, intet farveskift. Kun PNG'en er pakket om (11%
mindre fil). Vejen ind i Defold er **kilderne i `Grafik/`** (ensartet gitter =
Defolds tile source-format), ikke vores pakkede web-atlasser.

---

## Hvad spillet vejer (målt 21. juli)

To helt forskellige tal, og kun det ene er et problem:

| | på disken | udpakket i hukommelsen |
|---|---|---|
| ridderens ark (20 stk.) | 3,7 MB | **150,0 MB** |
| zombie-ark (7 stk.) | 0,8 MB | 52,5 MB |
| intro-billeder | 0,8 MB | 18,0 MB |
| lyd + musik | 10,6 MB | (strømmer) |
| resten | 1,2 MB | 39,6 MB |
| **i alt** | **17,1 MB** | **260,1 MB** |

**Disken er ingenting** — 17 MB er en bagatel. **Hukommelsen er det knappe.**
Et billede pakkes helt ud til rå pixels for at kunne vises: hver pixel fylder
4 bytes uanset hvor godt filen lod sig pakke. Derfor er keglens ark 164 gange
større i hukommelsen end på disken (det er næsten kun gennemsigtighed).

**Elefanten er ridderen: 150 MB.** Tyve ark à 1920×1024 — ti animationer plus
ti lysmasker til rim-lyset, og lysmaskerne alene er 75 MB. De monteres alle
samtidig med vilje (kilde-skift midt i kampen gav hak), men det er en pris,
der først viser sig på en telefon.

**Hvert ark koster 7,5 MB uanset indhold.** `melee.png` fylder 872 KB på
disken og `idle-rim.png` fylder 17 KB — i hukommelsen fylder de nøjagtig det
samme. Et ark er 1920×1024 pixels à 4 bytes. Punktum.

### ATLAS-PAKNINGEN — navnet på arbejdsgangen

Sådan hedder den, når vi taler om den: **atlas-pakning**. Opskriften:
1. Beskær hvert **billede** (ikke hvert ark) til sin egen tætteste kasse.
2. Pak kasserne tæt (hylde-pakning, aldrig roteret, 2 px luft).
3. Skriv facitlisten i `atlas.json` — seks tal pr. billede, inkl. hvor det
   sad i den gamle 128-celle.
4. Spillet lægger forskydningen tilbage ved tegning → ankeret bevares.
5. **Bevis** med `node tools/verify-sprites.mjs <ref> <mappe>` at hvert
   eneste billede er pixel-identisk med originalen fra git.

**Gjort:** ridderen (150 → 39 MB, 2400 billeder bevist) og fjenderne
(53 → 7 MB, **86% sparet** — zombien fylder ned til 9% af sin celle; 840
billeder bevist). Spillet i alt: **260 → 104 MB**.

**Ikke pakket endnu:**
- `effects/blood.png` — 5 rækker × 15 billeder, 4,7 MB udpakket. Kan tages
  med samme opskrift (renderen forstår allerede `rows`), men er småpenge.
- `effects/glow.png` og kegle-stregerne — allerede små/pakkede; intet at hente.
- Intro-/menubilleder — fotografier, ikke sprite-gitre; atlas-pakning gælder ikke.
- Kraniet — vendored kit, røres ikke.

### Pakning: GJORT 21. juli — ridderen 150 → 39 MB

Hvert **billede** er beskåret til sin egen kasse og pakket tæt (ChatGPTs idé,
målt bedre end min første version: én kasse pr. *ark* gav 97 MB, én pr.
*billede* giver 39). Layoutet ligger i `assets/sprites/knight/atlas.json` —
seks tal pr. billede: hvor det ligger i arket, hvor stort det er, og hvor det
sad i den gamle 128-celle. Spillet lægger den sidste forskydning tilbage, så
ankeret er uændret.

**Bevist identisk:** `node tools/verify-sprites.mjs 631b25c~1` sammenligner
alle 2400 billeder pixel for pixel mod de oprindelige utrimmede ark. Ingen
afvigelse. Værktøjet er gemt — det er dét, der gør sådan et indgreb
forsvarligt, for øjet kan ikke revidere 2400 billeder.

**Fælden, værd at huske:** klippeboksen var stadig 128×128, mens cellerne var
krympet — så nabobillederne sivede ind i rammen. Klippet skal følge billedet.
Fanget ved at måle hvor silhuetten *landede*, ikke ved at kigge.

**Rul tilbage:** `PACK.enabled = false` øverst i `tools/build-sprites.mjs` +
`npm run build:sprites` → almindelige 15×8-ark igen, og spillet følger med af
sig selv. Originalerne ligger desuden i git.

**Spillet i alt: 260 → 149 MB.** Zombierne er **ikke** pakket endnu og er nu
den største post (52,5 MB) — samme greb dér, og de har mere luft end ridderen.

**Hvad pakningen gør ved ydelsen (målt 21. juli):** løbende fps er *uændret*
(236 fps, hak 0) — at tegne et billede koster det samme uanset teksturens
størrelse. Men **afkodningen er 4-5× billigere**: idle 1,3 ms, melee 5,2 ms,
mod 1,97 mio. pixels pr. ark før. Det er præcis den udgift, Magnus beskrev som
*"7,5 MB decode på main thread = 90 ms hak"*. Derfor er pakningen af
zombierne mere end hukommelse: Magnus har netop sat dem til at **skifte kilde
direkte**, hvilket betaler afkodningen igen hver gang.

**Prisen jeg tilføjede, nu målt:** rammens størrelse ændrer sig pr. billede
(før fast 128), så browseren omberegner layout. Isoleret i en test med 20 lag
opdateret hver frame: **0,142 → 0,237 ms, altså 0,095 ms ekstra = 0,57% af et
60 fps-budget.** Og det er det pessimistiske tal — ridderen skifter billede
10-24 gange i sekundet, ikke 60, så i praksis omkring 0,025 ms. Reelt, men
uden betydning. (Måling i det *kørende* spil mislykkedes: 6 rAF-frames på 6
sekunder, altså frossen rude — tallene derfra kasseret.)

---

### Baggrunden for beskæringen (målt 21. juli)

Cellerne er 128×128, men figuren fylder dem sjældent. Målt på hvert ark
(tætteste kasse der rummer alle 120 celler, så ét fælles anker bevares):

| ark | indhold | tomt |
|---|---|---|
| idle-rim | 44×73 | **80%** |
| walk-rim | 52×75 | 76% |
| idle | 60×79 | 71% |
| walk | 72×88 | 61% |
| takedamage | 80×96 | 53% |
| run | 88×97 | 48% |
| unsheathsword | 124×117 | 11% |

**Ridderen: 150 MB → 83 MB (45% sparet).** Lysmaskerne er de tommeste af
alle — rim-lyset klæber tæt til figuren, så der er næsten kun luft omkring.

**Beskæring + rim bagt ind = 150 MB → 41 MB.** Samme skarphed, intet
udseende ændret. Det er bedre end 64 px-arkene (38 MB) uden at koste
en eneste detalje.

Arbejdet: byggeriet gemmer hvert arks forskydning, `AnimDef` får den med,
og `SpriteSheet` lægger den til når den tegner. Ankeret bevares *fordi*
forskydningen følger med — den gamle bekymring om at ridderen ville hoppe
mellem animationer gælder kun ved én fælles beskæring, ikke ved én pr. ark.

### Beslutning der venter: skal rim-lyset bages ind? (Nicolai, 21. juli)

Nicolai foreslår at gøre rim-lyset til en **permanent del af arkene**, så vi
ikke har to ark pr. animation — ét med og ét uden.

| | ark | hukommelse | mister vi |
|---|---|---|---|
| **som nu** | 20 | 150 MB | — |
| **bagt ind** | 10 | **75 MB** | farve/styrke kan ikke skrues live |
| kun mindre masker (½) | 20 | 94 MB | intet synligt (kanten er 2 px blød) |

**Bagt ind er det store snit: halvdelen af ridderens regning væk.** Prisen er,
at `RIM_STYLE` (farve, styrke, blandingsmåde) bages fast ved bygningen i
stedet for at kunne skrues i spillet — men værdierne har stået urørt siden
Nicolai godkendte dem, og de kan stadig ændres med en genbygning
(`npm run build:sprites`, få sekunder). Sliderne under `DEBUG_RIM_TUNING`
ville skulle bruges *før* bygningen i stedet for under spillet.

**Ikke gjort endnu — afventer Nicolais go.** Bygningen kender allerede
maskerne (`RIM` i `tools/build-sprites.mjs`); den skal blot lægge dem oven på
arket i stedet for at skrive dem ved siden af, og `AnimDef.rim` + rim-laget i
`SpriteSheet` kan så ryge ud.

### Farvereduktion og palette-teksturer: virker ikke her

Færre farver gør PNG'en mindre **på disken**, men ikke i hukommelsen —
browseren pakker altid ud til 4 bytes pr. pixel. En ægte palette-tekstur
(1 byte pr. pixel, 75% sparet) kræver en shader, og den dør har vi ikke
adgang til med almindelige billeder i en browser. **Kunne åbne sig**, hvis
spillet en dag flytter ind i Magnus's `wip/skia-play-area-canvas`.

### Mindre ark? Afprøvet og lagt fra os (21. juli)

I hukommelsen sparer mindre celler præcis kvadratisk: 96 px = 44%, 64 px =
75%. Testet med `node tools/test-resolution.mjs` (skriver kun ét
sammenligningsbillede, rører ingen ark):

- **96 blød** — udvasket, sværdet flyder ud. Nej.
- **96 nearest** — hakket; 1,33 går ikke op, så pixelrækker forsvinder ujævnt. Nej.
- **64 nearest** — knivskarp (2× går op), men grovere: sværdet bliver en klump.
  Legitim stil, men et *udseendevalg*.

**Nicolais dom: vi lader det være.** 64 ligger i baghånden, hvis en telefon
en dag siger stop. Rim-bagningen ovenfor sparer mere (75 MB) og koster intet.

### Regnen: den store tilbageværende (ikke gjort)

**230 animerede lag, permanent** — mod keglens 8 i to sekunder. Det er
langt den største post nu. Bages som ét gentaget felt: ~4 MB for at gå fra
230 lag til 1-2. Risici: gentagelsen kan ses (modtræk: større tern + to lag
i forskellig fart), og dybden fra dråbernes egen variation går tabt.
Vandringene (10 lag) er ikke besværet værd.

---

## Hvordan vi laver effekter fremover (aftalt 21. juli)

Nicolai spurgte om det ville være lettere at **tegne** effekterne. Svaret er
ja — og ikke en smule, men en helt anden størrelsesorden:

| | elementer | koster |
|---|---|---|
| Tegnet ark (ridderen, en zombie) | **1** | ingenting |
| Regn | ~250 | fint |
| Kegle-zonen | ~680 | mærkes |

Et tegnet ark er **ét** element, uanset hvor mange detaljer der er i
billedet — browseren tegner ét billede. Genererede pixels koster ét element
**hver**, og hvert eneste skal beregnes, animeres og sammensættes for sig.
**Detaljer er gratis i en tegning og lineært dyre i kode.**

**Reglen fremover:** spørg altid først "kan det her være en tegning?" Har
effekten et fast udseende — ild, eksplosion, magi, et slag — så tegn den som
et ark med **8 rækker (én pr. retning, ligesom ridderen)**, så intet skal
roteres. Kode-genererede effekter er kun til det, der skal følge levende tal:
regn der skal dække enhver skærm, ringe der skal ramme rigtigt vand, en kegle
der skal matche sin sande vinkel.

**Kegle-zonen er slanket 21. juli:** 680 → **428 pixels** (loft 420), og 394
af dem er selve stregerne. Færre buer (96 px imellem i stedet for 52), kant og
dither næsten væk. Det blev både billigere *og* renere — nu er ni tiendedele
af det tegnede dét, øjet skal følge.

**Men det var ikke nok — Nicolai mistede stadig ~150 fps**, og hans dom var
rigtig: *"vi kan ikke sidde og skræddersy vores animationer sådan her."*
Så stregerne er nu **bagt til et sprite-ark**, ligesom ridderen og zombierne.

`tools/build-cone-fx.mjs` (`npm run build:fx`) tegner de 8 buer én gang og
skriver `assets/sprites/fx/cone-arcs.png` + en lille JSON med cellemål og
radier. Spillet placerer celle *i* med sin højrekant på radius *i* langs
kastretningen og drejer hele beholderen — så bølgens rejse koster ingenting;
det er otte billeder, der tændes efter tur.

| | før | nu |
|---|---|---|
| elementer pr. kast | 428 | **17** |
| animerede lag | 428 | **8** |
| på disken | — | 7 KB |
| i hukommelsen | — | 0,95 MB |

**Hvorfor stregen og ikke hele kilen:** udfoldet er keglen 789 × 650 px, så en
film af den er enten 40 MB eller så få billeder, at bølgen kravler. En streg
er tynd, der er otte, og rejsen er gratis.

**Byg om:** ret tallene øverst i `build-cone-fx.mjs` (buernes afstand, tæthed,
farver) og kør `npm run build:fx`. Geometrien skal matche `CONE_ZONE` og
`ABILITY2_HALF_ANGLE_DEG` i App.tsx — de få tal står dubleret med vilje og med
en advarsel i scriptet.

Tabt undervejs: kanten og ditheren mellem stregerne (var 5-24 pixels), og
variationen fra kast til kast. Prikkerne er bagt, så alle kast er ens.

**Den rigtige løsning, hvis det stadig er for tungt — "bagning":** vi behøver
ikke at *tegne* noget. Et byggescript kan **regne effekten ud på forhånd** med
præcis den matematik, der allerede står i koden, og gemme den som et
sprite-ark. Ingen tegneopgave for nogen. To udgaver, målt 21. juli:

**A — bag hele keglen.** Udfoldet fylder den 789 × 650 px pr. billede:

| opløsning | 20 billeder | i hukommelsen |
|---|---|---|
| fuld | 10,3 mio. px | **39 MB** — for meget |
| halv | 2,6 mio. px | **9,8 MB** ≈ ét zombie-ark |
| kvart | 0,6 mio. px | 2,4 MB, men 2-px-pixels bliver til en halv |

Så halv opløsning vist i dobbelt størrelse med skarp (nearest-neighbour)
skalering. Prisen: **428 elementer → 1**, mod ~10 MB hukommelse. Alle kast
bliver ens, og roterede pixels bliver en anelse bløde.

**B — bag kun stregen** (bedre, hvis A er for dyr). Buerne er 394 af de 428
pixels, altså næsten hele effekten. Bag én streg som et lille ark og lad
spilløkken flytte og skalere den udad, ligesom den flytter zombier. Så er det
**en håndfuld elementer og et billede på under en MB**. Kræver at halen af
gløder tænkes om.

Ingen af dem er bygget. Test den slankede udgave (428) først — er den god nok
på Nicolais maskine, sparer vi hele arbejdet.

---

## Kraniet er parkeret — godkendt, men venter på sin plads

Kronekraniet (`Cranium-Coin-bag`) er inde, virker og er **godkendt af Nicolai**
("den er flot") — men det er slået fra 20. juli om aftenen, så det ikke koster
en frame mens det venter. Slukket betyder helt væk: ingen motor, ingen fysik,
og dets 17 filer hentes heller ikke ved start.

**Kald det frem igen:** sæt `COINSACK_ENABLED = true` i `App.tsx`, og
`DEBUG_COINSACK_TUNING = true` for placerings-sliderne. Puslespillet der
venter: standardpladsen (68/8/254) ligger bag **Magnus's nye Ranged-knap** fra
hans loadout-bjælke — det var derfor han selv bænkede den gamle pung. Under
254 i bredde blødgøres pixel-looket (buffer 1:1 ved præcis 254).

Den gamle snoresæk ligger stadig urørt til fortrydelse: `vendor/coin-sack/`
plus kunsten i `assets/coinsack/14f/` og `shade.png` — lydene er de samme
filer. Når et af de to designs er endeligt, ryddes det andet op inden PR'en.

---

## Set, men ikke gjort noget ved

**Introen fortæller ikke at man kan trykke sig videre.** Det virker, men en
spiller opdager det ikke af sig selv.

**Hak-jagtens stilling (20. juli, aften):** vejret var hovedsynderen og er
løst — CSS-loops, 10 synlige ringe, regn i 15 fps stop-motion, 230 dråber.
60-loftet på spilløkken tog derefter det hvilende hak ("bedre fps" — Nicolai,
efter test). Vandpyt-problemet fra tidligere på listen er løst i samme ombæring:
ringene deles nu kun ud over synligt vand.

Ikke målt endnu, hvis der jages videre: møntsækkens matter.js-løkke (kører
altid, også tom — kunne få en A/B-kontakt som vejret), zombie-ark der pakkes
ud ved første møde med en ny fjendetype (op til 5 × 7,5 MB midt i kampen —
kunne varmes op under den sorte fade), og flash-laget der monteres ved
træffere. Målepanelet og de to
kontakter (DEBUG_PERF i App.tsx) står klar til jagten.

---

## Løst i mappen

- `test.png` ligger i projektroden og er ikke i git. Formentlig affald.
- Grenen `coinbag-first-attempt` findes stadig — det var det første forsøg på
  møntsækken, som blev kasseret.
- **21 ridder-animationer i `Grafik/Knight` bygges ikke:** 180Turn, CastSpell,
  CrouchIdle, CrouchRun, FrontFlip, Idle2, Melee2, MeleeRun, MeleeSpin,
  Pummel, Rolling, Run up No sword, RunBackwards, ShieldBlockMid,
  ShieldBlockStart, Slide, SlideEnd, SlideStart, StrafeLeft, StrafeRight,
  Walk.
  10 er i spillet (idle, walk, run, melee, takedamage, unsheath, kick, die,
  special1, special2). `Walk` (med sværd) er holdt ude fordi kun indgangen
  går, og der har han ikke trukket endnu.

- **Melee2 er øremærket, ikke glemt** (Nicolai, 20. juli): gemt til "noget
  kombo-halløj når helten bliver vildere" — altså sving-variation eller en
  kombo-kæde, når den tid kommer. Det er hans næststørste ark (103×125 af
  cellens 128, rører kanten — derfor beskæres celler aldrig), og møllen
  tager den ind med én linje i `SHEETS`, når den skal bruges.
