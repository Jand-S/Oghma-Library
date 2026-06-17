import argparse
import asyncio

from .runner import run


def main() -> None:
    ap = argparse.ArgumentParser(prog="oghma.publish", description="Export estatico do acervo p/ bucket")
    ap.add_argument("--source", required=True, help="id da fonte, ex.: central-novel")
    ap.add_argument("--out", default=None, help="dir de saida (default: <storage>/publish)")
    ap.add_argument("--no-upload", action="store_true", help="so gera local, nao sobe")
    ap.add_argument("--dry-run", action="store_true", help="simula o upload (lista ops, nao sobe)")
    ap.add_argument("--full", action="store_true", help="regera todos os bundles")
    args = ap.parse_args()
    summary = asyncio.run(run(args.source, out_dir=args.out, no_upload=args.no_upload,
                              dry_run=args.dry_run, full=args.full))
    import json
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
