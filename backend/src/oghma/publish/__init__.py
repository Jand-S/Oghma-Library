"""Export estatico do acervo para um bucket S3 (R2/B2) + Cloudflare.

Pacote isolado: roda via `python -m oghma.publish`. O build (catalogo/bundles/capas)
usa so a stdlib; `boto3` so e importado no passo de upload.
"""
