import re, os

SRC = "appUi.tsx"
text = open(SRC, encoding="utf-8").read()
assert 'export * from "./views/' not in text, "appUi.tsx ja e um barrel — nada a fazer"
assert text.count("\n") > 1400, "appUi.tsx parece truncado — restaure do git antes de rodar"

# cabecalho de imports = tudo antes de 'const tags ='
m = re.search(r'(?m)^const tags = ', text)
assert m, "nao achei 'const tags ='"
header = text[:m.start()].rstrip()
rest = text[m.start():]

# bloco de constantes (ate antes do SetupSyncEntry) + o type SetupSyncEntry
idx_setup = rest.index("export type SetupSyncEntry")
const_block = rest[:idx_setup].rstrip()
m2 = re.search(r'export type SetupSyncEntry = \{.*?\};', rest, re.S)
setup_type = m2.group(0)
comp_body = rest[m2.end():]

os.makedirs("constants", exist_ok=True)
os.makedirs("views", exist_ok=True)

# 1) constants/ui.ts  (todas as consts viram export)
const_exported = re.sub(r'(?m)^const ', 'export const ', const_block)
open("constants/ui.ts", "w", encoding="utf-8").write(
    'import { Download, Globe2, Home, Library, Settings } from "lucide-react";\n'
    'import type { IndexMode, TranslationEngine, ViewId } from "../types";\n\n'
    + const_exported + "\n\n" + setup_type + "\n"
)

# 2) prelude dos views = imports originais (./ -> ../) + import das constantes
prelude = re.sub(r'from "\./', 'from "../', header) + (
    '\nimport {\n  indexModeOptions,\n  onboardingSteps,\n  pageTitle,\n  statusLabel,\n'
    '  tags,\n  translationEngineOptions,\n  views,\n  type SetupSyncEntry\n} from "../constants/ui";\n'
)

# 3) fatiar componentes por 'function NAME'
starts = [(mm.start(), mm.group(2)) for mm in re.finditer(r'(?m)^(export )?function ([A-Z][A-Za-z0-9_]*)\s*\(', comp_body)]
comps = {}
for i, (pos, name) in enumerate(starts):
    end = starts[i+1][0] if i+1 < len(starts) else len(comp_body)
    comps[name] = comp_body[pos:end].rstrip()

groups = {
  "shell":      ["SplashScreen", "Titlebar", "Sidebar"],
  "discover":   ["FiltersPanel", "NovelCard", "SkeletonGrid", "SelectionConfigurator", "DiscoverView"],
  "sources":    ["SourcesView"],
  "downloads":  ["DownloadsView"],
  "kindle":     ["ConversionModal", "KindleTransferModal"],
  "onboarding": ["OnboardingWizard"],
  "library":    ["LibraryView"],
  "settings":   ["SettingsView"],
}
mapped = {c for v in groups.values() for c in v}
assert set(comps) == mapped, f"componentes divergentes: faltam {set(comps)-mapped}, sobram {mapped-set(comps)}"

for fname, names in groups.items():
    body = "\n\n".join(comps[n] for n in names)
    open(f"views/{fname}.tsx", "w", encoding="utf-8").write(prelude + "\n" + body + "\n")

# 4) appUi.tsx vira barrel
barrel = "".join(f'export * from "./views/{g}";\n' for g in groups)
barrel += 'export { pageTitle, onboardingSteps } from "./constants/ui";\n'
barrel += 'export type { SetupSyncEntry } from "./constants/ui";\n'
open(SRC, "w", encoding="utf-8").write(barrel)

print("OK ->", sorted(comps))