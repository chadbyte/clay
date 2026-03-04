# Clay Design Principles

## Identity

Clay는 **earthy warmth + vibrant accents** 의 조합이다.
칙칙하지 않으면서도 과하지 않은, 흙과 유약의 관계처럼
차분한 바탕 위에 선명한 포인트가 올라가는 느낌.

파비콘(favicon.svg)이 이 정체성의 원본이다.
디자인 판단이 흔들릴 때 파비콘을 본다.

---

## Color System

### Clay Palette — Accent (Coolors)

세 가지 악센트 그룹, 각각 3단계 밝기:

| Group | Bright | Mid | Deep |
|-------|--------|-----|------|
| Green | `#09E5A3` | `#00B785` | `#066852` |
| Blue  | `#5857FC` | `#2A26E5` | `#1C1979` |
| Red   | `#FE7150` | `#F74728` | `#BA2E19` |

### Clay Palette2 — Body (Coolors)

Favicon body에서 추출한 클레이/로즈 톤. Light 테마의 base00-02 근거:

| Light | Mid | Deep |
|-------|-----|------|
| `#DAC7C4` | `#D6B6B0` | `#C0A9A4` |

### Favicon Reference Colors

테마 색상의 원본 소스. 빈도순 상위 색상:

**Light favicon body:**
`#C0A9A4` (primary), `#D6B6B0`, `#DAC7C4`, `#D4C0BD`, `#CBB8B2`, `#E3D0CC`

**Dark favicon body:**
`#252121` (primary), `#2E2929`, `#332E2E`, `#312C2C`, `#292525`

**Light favicon accents:**
Green `#00B785`, `#07E5A3`, `#0E725C`, `#02543E`
Blue `#2A26E5`, `#5857FC`, `#221B92`, `#04023E`
Red `#F74728`, `#FE7150`, `#B72C18`

**Dark favicon accents:**
Green `#4A9F85`, `#58BE9F`, `#3C7266`, `#2A5C4E`
Blue `#7D7BCD`, `#9E9EDA`, `#5A5893`, `#2C2B4C`
Red `#C97F70`, `#D59C90`, `#A56359`

### Base16 Slot Mapping

| Slot | Role | Light picks from | Dark picks from |
|------|------|-------------------|-----------------|
| base00-02 | Background tones | Clay/rose (favicon light body) | Warm brown (favicon dark body) |
| base03-05 | Text hierarchy | Warm grays | Warm grays, brighter than light |
| base08 | Error / destructive | Deep red | Mid red |
| base09 | **Primary accent** (terracotta) | Mid red | Bright red |
| base0A | Warning / yellow | Warm gold | Warm gold, saturated |
| base0B | Success / green | Deep green | Bright green |
| base0C | Info / teal | Deep teal | Teal |
| base0D | Links / blue | Rich blue | Bright blue |
| base0E | Special / purple | Muted purple | Saturated purple |
| base0F | Misc / brown | Clay brown | Clay brown |
| accent2 | **Secondary accent** (indigo) | Mid blue | Bright blue |

### Light vs Dark 원칙

- **Light**: 어두운 배경엔 밝은 글자가 아니라, 밝은 배경에 **짙은** 악센트. 팔레트에서 Mid~Deep 레벨을 쓴다.
- **Dark**: 어두운 배경에서 눈에 띄어야 하므로 Bright~Mid 레벨을 쓴다. Light보다 **한 단계 밝고 saturated**.

---

## Accent System

두 가지 악센트가 있다:

### `--accent` (base09, terracotta)
주요 인터랙션 컬러. 버튼, 링크 호버, 프로그레스 바, 포커스 링.

### `--accent2` (indigo)
정보/상태 표시 컬러. 다음에 사용:
- Activity text ("Photosynthesizing..." 등)
- User island avatar
- AskUserQuestion 선택 하이라이트
- Tool link hover, file history badge
- Session info copy button

Thinking block에는 accent2를 **쓰지 않는다** (overlay-rgb 기반 유지).

---

## Selection

텍스트 드래그 선택: `rgba(9, 229, 163, 0.25)` — 파비콘 그린 고정.
테마에 따라 변하지 않는 유일한 하드코딩 컬러.

---

## Rules

1. **하드코딩 금지** — 모든 컬러는 CSS custom property(`var(--xxx)`)를 통해 참조. Selection만 예외.
2. **파비콘이 기준** — 색이 맞는지 모르겠으면 파비콘과 나란히 놓고 본다.
3. **대비 확보** — 배경을 어둡게 내리면 텍스트도 같이 올린다. base03(dimmer)이 배경 대비 최소 4:1.
4. **accent2 남용 금지** — 정보/상태 표시에만 쓴다. 주요 인터랙션은 accent.
5. **테마 파일 네이밍** — `clay-*.json`. claude가 아닌 clay.
