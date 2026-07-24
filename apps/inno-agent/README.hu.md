# Inno Agent

[中文](README.md) | [Magyar](README.hu.md)

PI SDK-re épülő személyes tanulási Agent, amely többcsatornás interakciót (CLI / Web UI / Feishu / WeChat), háromszintű memóriarendszert (L1 tanulói profil + L2 Wiki-tudásbázis + L3 beszélgetési előzmények és beszélgetéseken átívelő keresés), ütemezett feladatkezelést, valamint Practice Lab webes terminált támogat.

> Ez a dokumentum a backend fejlesztési és futtatási részleteire összpontosít. A projekt átfogó bemutatását, architektúráját és célját a tároló gyökérkönyvtárában található [README.hu.md](../../README.hu.md) ismerteti.

## Előfeltételek

- Node.js >= 20.6.0
- Az `npm install` és az `npm run build` már lefutott (a tároló gyökérkönyvtárában)
- A `runtime/config/config.json` be van állítva (lásd: `config.example.json`; legalább egy provider `apiKey` értékét ki kell tölteni)

## Telepítés

```bash
# Backendfüggőségek
npm install

# Frontendfüggőségek
cd web && npm install && cd ..
```

## Indítás

### Fejlesztői mód (ajánlott)

Két terminálra van szükség:

```bash
# 1. terminál: a backend indítása (előbb fordítás, majd futtatás)
npm run build && npm run server
# A backend a http://localhost:3000 címen figyel

# 2. terminál: a frontend fejlesztői szerverének indítása
npm run web:dev
# A frontend a http://localhost:5173 címen figyel, és automatikusan a backendhez proxyzza az /api kéréseket
```

A böngészőben nyisd meg a **http://localhost:5173** címet.

### Újraindítás fejlesztés közben

Ha a módosítások után az oldal frissítése nem érvényesíti a változásokat, először állítsd le a régi frontend- és backendfolyamatokat:

```bash
pkill -f "node dist/server.js"
pkill -f "vite"
```

Ezután indítsd újra a két terminált:

```bash
# 1. terminál: backend
npm run build
npm run server

# 2. terminál: frontend
npm run web:dev
```

Újraindítási szabályok:

- A `src/server.ts` vagy backend API módosítása esetén futtasd az `npm run build` parancsot, majd indítsd újra a backendet.
- A `web/vite.config.ts` módosítása esetén indítsd újra a frontend fejlesztői szerverét.
- Ha csak a `web/src/` alatti frontendkomponensek vagy stílusok változnak, a Vite általában hot reloaddal frissít; elég az oldal frissítése.
- Ha a feltöltési felület, a Wiki API vagy a proxy nem működik, elsőként indítsd újra teljesen a frontendet és a backendet.

Az alábbi parancsokkal ellenőrizheted, hogy a szolgáltatások megfelelően működnek-e:

```bash
curl http://localhost:3000/health
curl http://localhost:5173/api/wiki/pages
```

### Éles üzemmód

```bash
# A frontend fordítása a web/dist/ könyvtárba
npm run web:build

# A backend fordítása és indítása (automatikusan kiszolgálja a web/dist/ statikus fájljait)
npm run build && npm run server
```

A böngészőben nyisd meg a **http://localhost:3000** címet.

### CLI mód

```bash
npm run build && npm start
```

### Sandbox mód

A `--sandbox` kapcsolóval OS-szintű sandboxot engedélyezhetsz ([pi-sandbox](https://github.com/carderne/pi-sandbox) alapokon), amely jogosultságokat szabályoz az Agent által végrehajtott bash parancsok és fájlműveletek számára.

Előfeltétel: telepítsd a `ripgrep` csomagot (`brew install ripgrep`).

```bash
# CLI + sandbox
npm run sandbox -- --home ./runtime --workspace ./workspace

# Server + sandbox
npm run server:sandbox -- --home ./runtime --workspace ./workspace --port 3000

# A --sandbox kapcsoló közvetlenül is átadható
npm run start -- --sandbox
npm run server -- --sandbox
```

A sandbox alapértelmezés szerint ki van kapcsolva, és csak a `--sandbox` átadásakor aktiválódik. Bekapcsolás után:

- a bash parancsok OS-szintű izolációban futnak `sandbox-exec` (macOS) / `bubblewrap` (Linux) használatával;
- a fájlolvasási/-írási/-szerkesztési műveletek jogosultságát a házirend ellenőrzi;
- blokkolás esetén interaktív kérdés jelenik meg, amelyben az egyszeri, projektszintű vagy globális engedélyezés választható.

Sandbox konfigurációs fájlok:

- Globális: `<configDir>/sandbox.json` (azaz `runtime/config/sandbox.json`)
- Projektszintű: `<workspaceDir>/.pi/sandbox.json` (magasabb prioritású)

Példakonfiguráció:

```json
{
  "enabled": true,
  "network": {
    "allowedDomains": ["github.com", "*.github.com"]
  },
  "filesystem": {
    "denyRead": ["/Users", "/home"],
    "allowRead": [".", "~/.config"],
    "allowWrite": [".", "/tmp"],
    "denyWrite": [".env", "*.pem", "*.key"]
  }
}
```

## Projektstruktúra

```
src/                  # Backend (Node.js)
├── cli.ts            # CLI belépési pont
├── server.ts         # HTTP Server + SSE + REST API
├── runtime.ts        # Futásidejű útvonalak feloldása (CLI flag > env > alapértelmezés)
├── agent/            # PI SDK AgentSession burkoló + inno kiterjesztések
├── channels/         # Feishu / WeChat és egyéb csatornák
├── scheduler/        # Ütemezett feladatok
├── memory/           # L1 tanuló + L2 Wiki + L3 beszélgetéseken átívelő keresési memória
│   ├── learner/      # L1 tanulói profil
│   ├── l2/           # L2 Wiki-tudásbázis
│   └── l3/           # L3 beszélgetési előzmények sqlite-indexe és küszöbalapú előhívása
├── terminal/         # Practice Lab WebSocket-terminál és futási előzmények
└── storage/          # Fájltárolás

.inno/skills/         # Az Inno Agent által ténylegesen betöltött projektszintű Skills könyvtár

web/                  # Frontend (React + Lit + Tailwind + Vite)
├── src/
│   ├── api/          # Tiszta TS fetch burkoló (keretrendszerfüggőség nélkül)
│   ├── stores/       # EventEmitter állapotkezelés (keretrendszerfüggőség nélkül)
│   ├── react/        # React komponensek
│   ├── components/   # Lit Web Components
│   ├── types/        # Megosztott típusok
│   └── utils/        # Segédfüggvények
└── index.html
```

## API-végpontok

| Metódus | Útvonal | Leírás |
|------|------|------|
| GET | `/health` | Állapotellenőrzés |
| POST | `/api/chat` | Üzenet küldése (teljes válasz) |
| POST | `/api/chat/stream` | Üzenet küldése (SSE-stream) |
| GET | `/api/sessions` | Beszélgetések listája |
| GET | `/api/sessions/:id` | Beszélgetés részletei |
| GET | `/api/wiki/pages` | Wiki-oldalak listája |
| GET | `/api/wiki/page?path=` | Wiki-oldal beolvasása |
| PUT | `/api/wiki/page` | Wiki-oldal mentése |
| GET | `/api/wiki/graph` | Tudásgráf adatai |
| GET | `/api/wiki/stats` | Wiki-statisztikák |
| GET | `/api/skills` | Skills lista (a `.inno/skills/` könyvtárból) |
| POST | `/api/skills/upload` | `<skill-name>.zip` feltöltése és kicsomagolása a `.inno/skills/<name>/` könyvtárba |
| PATCH | `/api/skills/:name` | Skill engedélyezése/letiltása |
| DELETE | `/api/skills/:name` | Skill törlése |
| POST | `/api/skills/reload` | PI-erőforrások újratöltése |
| GET | `/api/settings` | Konfigurációs adatok |
| GET/POST/PATCH/DELETE | `/api/jobs[/:id]` | Ütemezett feladatok CRUD műveletei |
| POST | `/api/jobs/:id/run` | Feladat azonnali végrehajtása |
| GET | `/api/jobs/status` | Ütemezett feladatok összesített állapota |
| GET | `/api/jobs/runs` | Legutóbbi feladatfuttatások előzményei |
| GET | `/api/jobs/:id/runs` | Adott feladat futási előzményei |

## Ütemezett feladatok futtatókörnyezete

A backend indításakor betölti a `data/jobs/jobs.json` fájlt, és kiegészíti a régi feladatokat a futási állapot mezőivel:

- `nextRunAt`: a cron és a timezone alapján számított következő futási időpont.
- `lastStatus` / `lastError`: a legutóbbi futás állapota.
- `runCount` / `failureCount`: a futások és hibák összesített száma.

Minden feladatfuttatás egy JSONL-bejegyzést fűz a `data/jobs/runs.jsonl` fájlhoz; ez tartalmazza a futásazonosítót, a kezdő- és záróidőt, az időtartamot, az indítás forrását, a hibainformációkat és a kimenet összefoglalóját. A feladatokat a háttérben futó cron automatikusan is elindíthatja, illetve manuálisan is futtathatók a `/api/jobs/:id/run` végponton vagy a `run_scheduled_job` agent eszközön keresztül.
