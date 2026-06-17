"""Lista rotas Nuxt do House Saikai com os ids de chunk associados."""
from __future__ import annotations

import re

import httpx


MAIN = "https://housesaikai.net/_nuxt/71f48f1.js"
RUNTIME = "https://housesaikai.net/_nuxt/cc148ca.js"


def main() -> None:
    with httpx.Client(headers={"User-Agent": "Mozilla/5.0 OghmaProbe"}, timeout=30) as client:
        main = client.get(MAIN).text
        runtime = client.get(RUNTIME).text
    hashes = dict(re.findall(r"""(\d+):["']([^"']+)["']""", runtime))
    for match in re.finditer(r"""\{path:"(?P<path>[^"]+)",component:function\(\)\{return (?P<body>.{0,260}?)\},name:"(?P<name>[^"]+)""", main):
        path = match.group("path")
        name = match.group("name")
        body = match.group("body")
        if not any(part in path for part in ["series", "comics", "ler"]):
            continue
        ids = re.findall(r"""t\.e\((\d+)\)""", body)
        files = [f"https://housesaikai.net/_nuxt/{hashes[i]}.js" for i in ids if i in hashes]
        print(name, path, ids, files)


if __name__ == "__main__":
    main()
