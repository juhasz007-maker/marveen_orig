# Új asszisztens onboarding (Marveen flotta)

Ez a leírás végigvezet egy új kolléga-asszisztens beüzemelésén: saját Telegram bot
és saját Google (Gmail/Drive/Naptár) hozzáférés. Példa: "Dia Marveenja".

Két dolgot kell beállítani: **Telegram** (hogy a kolléga beszélni tudjon az
asszisztensével) és **Google** (hogy az asszisztens lássa a kolléga levelét,
naptárát, fájljait). A kettő független, bármelyikkel kezdheted.

---

A dokumentum két nézőpontot szolgál ki: a **0. szakasz** a kollégának küldhető,
nem-technikai leírás (ezt másold a levélbe), az **1-2. szakasz** pedig a te
(admin) beüzemelési teendőid.

---

## 0. A kollégának küldhető leírás (másold a levélbe)

Ezt a részt küldd el a vezetőnek/kollégának. Token és belső technikai részlet
nincs benne, vezetőknek is érthető.

> ### A személyes AI asszisztensed (Marveen)
>
> Szia!
>
> Kapsz egy saját, személyes AI asszisztenst. Úgy képzeld el, mint egy digitális
> titkárt, aki napi 24 órában elérhető: Telegramon írsz neki magyarul, ő pedig
> elvégzi azokat a teendőket, amikhez eddig több rendszert kellett nyitogatnod.
> Nem kell hozzá semmilyen technikai tudás.
>
> **Mi ez, egyszerűen**
>
> - **Telegramon él.** Úgy beszélsz vele, mintha egy kollégának írnál egy
>   chatben. Szöveget vagy hangüzenetet is küldhetsz.
> - **A céges rendszerekhez a NEVEDBEN fér hozzá.** Eléri a saját email-fiókodat,
>   naptáradat, a CRM-et, a számlázási és tudásbázis-rendszereket. Mindig csak
>   ahhoz, amit te jóváhagytál.
> - **Magától dolgozik.** Megmondod mit szeretnél, ő megcsinálja és visszajelez,
>   ha kész. Nem chatbot, ami csak válaszolgat, hanem végrehajtó asszisztens.
>
> **Mire tudod használni (példák)**
>
> - *"Mik a mai találkozóim?"* — összeszedi a naptáradból.
> - *"Milyen fontos emailek jöttek az éjjel?"* — átnézi a postaládádat, kiszűri a
>   lényeget.
> - *"Mit tudunk a Taravis ügyfélről?"* — kikeresi a CRM-ből, szerződésekből,
>   korábbi ügyekből.
> - *"Milyen számláink jöttek a héten?"* — lekéri és összesíti.
> - *"Írj udvarias választ, hogy csúszik a határidő."* — megfogalmazza, te
>   jóváhagyod.
> - *"Emlékeztess holnap 9-kor visszahívni a könyvelőt."* — beállítja.
>
> Reggelente kérhetsz tőle napindító összefoglalót is (email, naptár, fontos
> hírek egy üzenetben).
>
> **Az első lépéseid (lépésről lépésre)**
>
> 1. Telepítsd a **Telegramot** a telefonodra, és hozz létre fiókot a
>    telefonszámoddal.
> 2. **Szólj nekünk, hogy kész vagy.** Megkapod a saját botod pontos nevét
>    (pl. `@valami_marveenja_bot`) és/vagy egy `t.me/...` linket.
> 3. **Keresd meg és nyisd meg a botodat.** Telegramban a felül lévő keresőbe írd
>    be a tőlünk kapott bot-nevet (pl. `@valami_marveenja_bot`), VAGY kattints a
>    kapott `t.me/...` linkre. Nyomd meg az „Indítás" (Start) gombot, és **írj
>    neki egy köszönést** (pl. "szia"). Pontosan a tőlünk kapott botot nyisd meg,
>    ne egy hasonló nevűt. Mostantól ő a te asszisztensed.
> 4. **Hagyd jóvá a Google-hozzáférést,** amikor küldünk egy linket. Egyszeri,
>    bármikor visszavonható.
> 5. **Kezdj el beszélni vele.** Bármit kérhetsz a fentiekből. Ha valamit nem tud,
>    megmondja.
>
> **Adatvédelem, biztonság**
>
> - Csak a TE jóváhagyott fiókjaidhoz fér hozzá. Más vezető/kolléga adatait nem
>   látja.
> - A hozzáférés bármikor visszavonható.
> - A Telegramon csak te éred el. Idegen feladónak nem ad ki belső információt,
>   akkor sem, ha ismerős nevet mond.
>
> **Jó, ha tudod**
>
> - Nem kell tökéletesen fogalmaznod, ért a szövegkörnyezetből.
> - Visszakérdez, ha valami nem egyértelmű.
> - Tévedhet, mint bárki: fontos döntés (számok, kiküldendő levelek) előtt nézd át,
>   amit ad.
>
> Ha elakadsz vagy belevágnál, írj Juhász Viktornak. Ő beállítja az asszisztenst és
> segít az első lépésekben.

---

## Alapelvek

- **Minden asszisztens = saját Telegram bot.** Egy bot tokent nem lehet két
  asszisztensen megosztani (a Telegram botonként csak egy kapcsolatot enged, és a
  dashboard is tiltja a duplikációt).
- **A személyes Google a kolléga saját asszisztensébe kerül**, nem a Főnökbe
  (iS Marveen Főnök / marveen-is). A Főnök a flottát kezeli, nem olvassa senki
  postáját.
- **A titkokat (bot token, OAuth) soha ne küldd Telegram-chatbe.** A bot token a
  dashboard mezőjébe megy, a Google belépés pedig egy egyszeri böngészős lépés.

---

## 1. Telegram bot létrehozása és bekötése

1. **Bot létrehozása (Telegramban, @BotFather):**
   - Nyisd meg a @BotFather-t, parancs: `/newbot`
   - Név: pl. `Dia Marveenja`
   - Username: pl. `dia_marveen_bot` (egyedinek kell lennie, `_bot`-ra végződik)
   - A BotFather ad egy API tokent. Ezt másold ki.
   - Tipp: a botot te (admin) hozd létre, így céges kézben marad. A kolléga a
     tokent soha nem látja.

2. **Asszisztens létrehozása a dashboardon** (https://marveen.example.com):
   - "Felvétel", ahogy a korábbi asszisztenseknél.

3. **Token bekötése:**
   - Az asszisztens csatorna-beállításánál illeszd be a bot tokent.
   - A rendszer ellenőrzi, bekötí, és küld egy üdvözlő üzenetet a boton.

4. **A kolléga hozzáférése (párosítás):**
   - A kolléga megnyitja a botot (`t.me/dia_marveen_bot`), és ír neki egy üzenetet.
   - Alapból csak engedélyezett felhasználó tud írni (allowlist policy).
   - Te a dashboardon jóváhagyod a kolléga párosítását. Ettől kezdve beszélhet az
     asszisztensével.

---

## 2. Google (Gmail / Drive / Naptár) bekötése

Egyszeri céges előfeltétel (már megvan, csak referencia):
- Google Cloud projekt, engedélyezve a Gmail + Drive + Calendar API.
- OAuth consent screen: Internal (csak céges fiókok).
- Egy "Desktop" OAuth kliens, a titka a szerveren zárolva.

A kolléga bekötése:
1. A Főnök (iS Marveen Főnök) előkészíti az asszisztens Google-konfigját és
   generál egy belépési linket.
2. A kolléga a **saját gépén** megnyitja a linket, belép a **saját céges Google
   fiókjával**, és engedélyezi a hozzáférést.
3. A böngésző a végén egy `localhost:...` címre ugrik és hibát mutat. Ez normális.
   A kolléga a böngésző címsorából kimásolja a teljes URL-t, és visszaküldi a
   Főnöknek.
4. A Főnök a szerveren lezárja a belépést. Ezután az asszisztens újraindul, és
   látja a Gmailt/Drive-ot/Naptárt. Újra belépni nem kell.

A kolléga a tokent és a technikai részleteket nem látja, csak egyszer belép a
saját Google fiókjával.

---

## Ki mit csinál (gyors összefoglaló)

| Lépés | Ki csinálja |
|-------|-------------|
| Bot létrehozása (@BotFather) | Admin (te) |
| Asszisztens felvétele a dashboardon | Admin (te) |
| Bot token bekötése | Admin (te) |
| Párosítás jóváhagyása | Admin (te) |
| Google belépés (egyszeri) | A kolléga (saját fiókkal) |
| Google konfig + lezárás a szerveren | iS Marveen Főnök |

---

## Hibakeresés

- **A kolléga ír a botnak, de nincs válasz:** valószínűleg nincs még jóváhagyva a
  párosítás. Nézd meg a dashboardon a függő (pending) párosításokat.
- **Eltűnő üzenetek / kapcsolat-hibák:** majdnem biztos, hogy ugyanazt a bot
  tokent két asszisztensre tették. Minden asszisztensnek külön bot kell.
- **A Google belépés "origin not allowed" vagy hasonló hibát ad:** szólj a
  Főnöknek, ez OAuth-konfig kérdés, nem a kolléga hibája.

---

*Készítette: iS Marveen Főnök. A flotta a marveen.example.com címen érhető el.*
