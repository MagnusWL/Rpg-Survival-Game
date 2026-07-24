# Coin sack — møntanimationen som en pakke

Mønter der falder ned i en sæk med rigtig fysik, i pixel-guld, med lyd. Løftes
ud igen med en ka-ching når man køber noget. Ingen UI, ingen scroll, ingen
Doomscroller — kun sækken.

**Prøv den først:** dobbeltklik `example.html`. Den virker uden server og uden
build, og lyden virker også. Er der noget galt med pakken, ser du det dér frem
for inde i dit spil.

## Hvad du skal bruge

**Matter.js 0.19.x**, indlæst før motoren og tilgængelig som `window.Matter`.
Fra CDN som i eksemplet, eller fra npm — motoren er ligeglad, den slår bare
`window.Matter` op.

Ellers ingenting. Ingen build, ingen andre pakker.

## Den korte version

```js
const sack = new CoinSack(canvas, options);

sack.addCoin();        // spilleren samlede en mønt op
sack.spendCoins(8);    // spilleren købte noget til 8
```

`addCoin()` er hele integrationen. Kald den én gang per mønt spilleren samler
op, så falder der en ned i sækken med lyd.

## Størrelsen sættes i CSS

Motoren læser canvas' kasse og skalerer både sækken og mønternes radius til at
passe. Så det her er det eneste sted en størrelse står:

```css
canvas { width: 96px; height: 170px; }
```

**Men der er et gulv.** Motoren regner altid internt i mindst 220×360, så med
`pixelSize: 2.4` er tegnebufferen altid 92×150 uanset hvad CSS siger. Det
afgør hvor klodset pixel-stilen ser ud:

| CSS-kasse | hver bufferpixel bliver | ser ud som |
|---|---|---|
| 64 × 113 | 0.70 css-px | skaleret **ned** — pixel-effekten går tabt |
| 96 × 170 | 1.04 css-px | 1:1, som tiltænkt |
| 140 × 250 | 1.52 css-px | tydeligt klodset |
| 220 × 390 | 2.39 css-px | meget klodset |

Vil du have pixel-looket, så hold dig på **96px bred eller derover** — eller
skru `pixelSize` op, som gør det samme fra den anden side. Se `pixel-lab.html`.

## Den bagte kunst (det eksemplet bruger)

`assets/pixel/14b|14c|14f/` er kunsten brændt ned til **58×58 pixels og fem
toner** af hvert temas metal, med hårde kanter. 3–4 farver per lag, ~250–420
bytes per fil — mod 160 KB for et helt originalt sæt.

Originalerne bliver liggende i `assets/14b|14c|14f/`. De er kilden; bag igen
derfra hvis du vil have andre tal.

Sammen med den bruger eksemplet **`pixelSize: 1.6`** frem for 2.4. Det er
modsat af hvad man skulle tro: et lavere tal giver en *større* buffer (138 mod
92), så møntklodsen får 4,38 bufferpixels i stedet for 2,92 og bliver skarpere.
Sækkens klodsethed kommer nu fra kunstens egne 58 pixels og er uafhængig af det.

**Det stiller et krav til visningsstørrelsen.** Bufferen er 138 bred, så lærredet
bør vises omkring 138 px eller derover, ellers skaleres hele billedet ned igen:

| CSS-bredde | skærmpixel per bufferpixel | |
|---|---|---|
| 96 px | 0.70 | hele billedet skaleres ned |
| **150 px** | **1.09** | stort set 1:1 — det eksemplet bruger |
| 220 px | 1.59 | opskaleret, ekstra klodset |

### Bag igen med andre tal

Kør det her i PowerShell fra `coin-sack-kit`. Ret `$OPL` (klodser) og ramperne:

```powershell
Add-Type -AssemblyName System.Drawing
$OPL = 58
$ramper = @{
  '14b' = @('#41381a','#63552a','#8f7d42','#b6a262','#e4d3a6')
  '14c' = @('#4a2619','#733f2c','#a5654a','#c98a6a','#f0cbb0')
  '14f' = @('#2c3036','#474d54','#6e747b','#9aa0a6','#cfd2d6')
}
# … resten står i git-historikken på denne fil (commit "Bake Nicolai's pixel
# settings into the art"), eller brug pixel-lab.html og bed om en ny bagning.
```

Pixel-lab'et kvantiserer ved indlæsning i stedet, så du kan skrue frit uden at
røre nogen filer. Bagningen er kun til når du har besluttet dig.

## Vil du skrue selv? Åbn pixel-lab.html

To sække side om side — venstre urørt, højre din.

**Vil du kun ændre sækken, så lad `pixelSize` være.** Den er hele bufferen og
rammer også mønterne: en møntklods er 7 logiske enheder, altså `7 / pixelSize`
bufferpixels, så den skrumper fra 2,92 til 1,59 hvis man går fra 2.4 til 4.4.
Mønterne mister deres form.

Sækken har sit eget håndtag, og det rører intet andet:

**Sækkens opløsning.** Motoren tegner kunsten i **107 bufferpixels** (384px-filen
skaleret ned). Sænker man kunstens egen opløsning under det, bliver den klodset
— og møntklodsen bliver liggende på 2,92. Ved 48 klodser fylder hver klods 2,2
bufferpixels.

**Sækkens farver.** Kunsten er blødt skygget: `sack-fg.png` har **693 unikke
farver** på 8.009 synlige pixels — én farve per elleve. Ægte pixel-art har 5–20 i
alt. Mønterne *er* tegnet som pixel-art, på en fast 5-toners guldrampe, og det er
netop dét misforhold der får sækken til at se for ren ud ved siden af dem.

Lab'et lægger kunsten ned på temaets egen 5-toners metalrampe, strakt til det
antal toner du vælger. Så bliver sækken pixel-art på samme præmis som mønterne —
og bundet til rammens farve i købet.

**Sidegevinst, målt:** kvantiseringen gør mønterne *skarpere*. En møntklods er
2,92 bufferpixels — ikke et helt tal, så kanten udjævnes mod baggrunden. Mod en
627-farvet blød sæk smører den ud, og ingen af de fem rene guldtoner overlever
i billedet. Mod en flad 6-farvet sæk overlever alle fem.

Skru, og tryk **Kopiér opskriften**. Den skriver også om `pixelSize` er rørt.

## Lyden kræver et klik. Altid.

Browsere nægter at spille lyd før brugeren har rørt siden, og motoren bygger kun
sin lydkontekst **én gang** — ved fødslen, som er længe før nogen har rørt
noget. Uden det her er sækken tavs, og der står intet i konsollen om hvorfor:

```js
function wake() {
  sack._ensureAudio();
  if (sack.audio && sack.audio.state !== 'running') sack.audio.resume();
}
['pointerdown', 'touchend', 'keydown'].forEach(e =>
  window.addEventListener(e, wake, { passive: true }));
```

Har dit spil en startskærm eller en "tryk for at spille", så er dét klikket —
kald `wake()` der. Bemærk at **scroll og mushjul ikke tæller** som en berøring;
det skal være et rigtigt klik, tryk eller tastetryk.

Vil du se om det virkede: `sack.audio.state === 'running'` og
`sack._sampleBufs.length === 14`.

## Lydfilerne hentes med fetch()

Så de skal serveres over **http**. Over `file://` er `fetch()` spærret, og
motoren sluger fejlen (`.catch(() => {})`) — så lydene er der bare ikke, uden et
ord nogen steder.

Derfor findes `sounds-inline.js`: de samme klip som `data:`-URI'er, så
`example.html` også lyder ved dobbeltklik. **Brug den ikke i dit spil** — peg på
filerne i `assets/` i stedet. Det er mindre og lader browseren cache dem.

## Sækken er et billede, tallet er dit

Sækken rummer `fillCount` mønter (16 i eksemplet). Mønter derudover får et skub
og triller ud over kanten, og bliver ryddet væk. **Tallet tæller ubekymret
videre** — så en spiller med 4.000 mønter er helt i orden, sækken viser bare de
16 øverste.

Hold din egen balance i dit spil. Sækken skal ikke spørges om hvor mange mønter
spilleren har; den skal have besked når tallet ændrer sig.

## API

```js
new CoinSack(canvas, options)

sack.addCoin()        // én mønt ned. Kald per opsamlet mønt.
sack.spendCoins(n)    // løft de n øverste ud + ka-ching. Returnerer hvor
                      // mange den nåede — højst det sækken viser, så
                      // prisen er dit regnestykke, ikke dens.
sack.reset()          // ryd alt, tæller til 0
sack.destroy()        // stop animationen og frigiv fysikken. Kald den når
                      // sækken fjernes, ellers kører den videre.
sack._resize()        // kald hvis canvas' kasse ændrer størrelse
```

Callbacks, sat i options:

```js
onCount: n => { ... }   // sækkens eget tal ændrede sig
onFull:  () => { ... }  // sækken blev lige fuld. Fyrer konfetti af, én
                        // gang, indtil den er under fillCount igen.
                        // Fin krog til en belønning.
```

## Options

Dem der betyder noget. Resten kan stå som i eksemplet.

```js
{
  style: 'artsack',       // brug den lagdelte PNG-sæk — det er den her
  art: {                  // de fem lag + skyggen
    bg, bgB, ringBack, fg, ringFront, shade
  },
  fillCount: 16,          // hvor mange mønter sækken rummer visuelt
  pixelate: true,         // mal hele sækken i lav opløsning (se tabellen)
  pixelSize: 2.4,         // større = mere klodset
  coinTones: [...],       // mønternes guld. Samme i alle tre farver.
  coinSamples: [...],     // 14 wav-stier — ét tilfældigt klip per mønt
  flipSample: '...',      // mp3 der spiller når mønten fødes
  spendStyle: 1,          // ka-ching ved køb, 1–4 er nære varianter
  soundOn: true,

  tempo: 0.85,            // faldhastighed
  gravity: 1.5,
  restitution: 0.42,      // hop
  friction: 0.58,         // hvor hurtigt de falder til ro
  bodyScale: 0.72,        // under 1 = mønterne overlapper og pakker tættere
  spin: 0.5,              // rotation i luften
  density: 0.006,         // vægt
}
```

## Farverne

Tre tonede sæt i `assets/`: **14b** messing, **14c** kobber, **14f** stål. Kun
sækken skifter — mønterne er det samme guld i alle tre, med vilje.

`assets/shade.png` er fælles for alle tre. Det er en mørk kopi af sækkens krop
der lægges over mønterne ved 30%, så mønter dybt nede læses som nedsænkede.

Lagene tegnes i den her rækkefølge, og det er dét der sælger illusionen om at
mønterne er *inde i* sækken:

```
sack-bg → sack-bg-b → ring-back → MØNTERNE → shade @30% → sack-fg → ring-front
```

## De to motorfiler

Samme motor, to indpakninger:

| fil | til |
|---|---|
| `coin-sack-engine.js` | `import { CoinSack } from './coin-sack-engine.js'` |
| `coin-sack-engine.global.js` | `<script src="...">`, sætter `window.CoinSack` |

Bruger dit spil moduler, så brug den første. Den anden findes fordi ES-moduler
ikke kan loades over `file://`, og `example.html` skal kunne åbnes ved
dobbeltklik.

Retter du i `coin-sack-engine.js`, så gendan den anden:

```sh
{ sed -n '1,10p' coin-sack-engine.global.js
  echo '(function () {'
  sed 's/^export class CoinSack/class CoinSack/' coin-sack-engine.js
  echo 'window.CoinSack = CoinSack;'; echo '})();'
} > /tmp/e && mv /tmp/e coin-sack-engine.global.js
```

## Hvor det kommer fra

Motoren og kunsten er fra design-handoff'en `Mønt falder i sæk 4`, via
Doomscroller-projektet, commit `91727aa` (17. juli 2026). Motoren er uændret
fra handoff'en.

Det her er en **kopi**, taget ud for at rejse videre. Retter du noget her,
kommer det ikke tilbage til Doomscroller af sig selv, og omvendt.
