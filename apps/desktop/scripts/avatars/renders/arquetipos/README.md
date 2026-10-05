# Arquétipos com variantes (avatares originais do Oghma)

20 arquétipos de gênero de novels/animes, 62 variantes no total. Personagens originais (sem direitos autorais), no mesmo estilo minimalista dos avatares de personagens: cores sólidas, sem contorno, sem rosto.

- `<arquétipo>-<n>.webp`: 512 px, **fundo transparente**. O app pinta o círculo com a cor que a pessoa escolher (as 12 cores da paleta do perfil estão em `manifesto.json` → `cores`).
- `manifesto.json`: ordem do seletor, nome e gênero de cada arquétipo e, por variante, o arquivo, a seed e o prompt.
- `folha.png`: todas as variantes sobre cores da paleta.
- O número de variantes varia por arquétipo (de 1 a 4): ficaram só as aprovadas na revisão.

## Como foram feitas

- Animagine XL 4.0 + LoRA Minimalist (peso 0,8, gatilho `ChopioM1nimalist`), pose fixa de busto com ControlNet OpenPose SDXL.
- Geradas em fundo cinza neutro e recortadas (`recortar.py`), com a transição desmisturada para não deixar halo.
- Gerador: `C:\Users\Jandson\Projects\oghma-avatares-gen` (`variantes.py`, `gerar.py --estilo variante`, `exportar_arquetipos.py`).

## Negativo

```text
(lineart:1.4), (outline:1.3), (eyes:1.3), mouth, nose, (shading:1.3), gradient, (detailed:1.3), texture, highlights, cel shading, sketch, text, watermark, signature, logo, frame, border, multiple views, (close-up:1.4), (head out of frame:1.4), (cropped head:1.3), (hat out of frame:1.3), (from behind:1.4), (yellow skin:1.3), (white skin:1.2), grey skin, pink skin, colored skin, heart, (silhouette:1.2), backlighting, (scenery:1.3), (detailed background:1.4), (background pattern:1.3), snowflakes, stars, plants, particles, (intricate details:1.3), ornate, nsfw, nude, cleavage, blurry, worst quality, low quality, low score, bad score, average score
```

## Arquétipos

### Cultivador (`cultivador`, Xianxia / cultivo)

- `cultivador-1.webp`: seed 3303 (cultivador-v1)
- `cultivador-2.webp`: seed 3303 (cultivador-v2)
- `cultivador-3.webp`: seed 3303 (cultivador-v3)
- `cultivador-4.webp`: seed 3303 (cultivador-v4)

### Mestra de seita (`mestra-seita`, Xianxia / cultivo)

- `mestra-seita-1.webp`: seed 3303 (mestra-seita-v1)
- `mestra-seita-2.webp`: seed 3303 (mestra-seita-v2)
- `mestra-seita-3.webp`: seed 1101 (mestra-seita-v3)
- `mestra-seita-4.webp`: seed 1101 (mestra-seita-v4)

### Mago reencarnado (`mago-reencarnado`, Isekai)

- `mago-reencarnado-1.webp`: seed 1101 (mago-reencarnado-v3)
- `mago-reencarnado-2.webp`: seed 1101 (mago-reencarnado-v4)

### Vilã de otome (`vila-otome`, Otome isekai)

- `vila-otome-1.webp`: seed 1101 (vila-otome-v1)
- `vila-otome-2.webp`: seed 3303 (vila-otome-v2)
- `vila-otome-3.webp`: seed 1101 (vila-otome-v3)
- `vila-otome-4.webp`: seed 3303 (vila-otome-v4)

### Caçadora (`cacadora`, Caçadores de masmorra)

- `cacadora-1.webp`: seed 3303 (cacadora-v1)
- `cacadora-2.webp`: seed 3303 (cacadora-v3)

### Alquimista (`alquimista`, Fantasia)

- `alquimista-1.webp`: seed 3303 (alquimista-v1)
- `alquimista-2.webp`: seed 3303 (alquimista-v2)
- `alquimista-3.webp`: seed 1101 (alquimista-v3)
- `alquimista-4.webp`: seed 3303 (alquimista-v4)

### Princesa guerreira (`princesa-guerreira`, Fantasia)

- `princesa-guerreira-1.webp`: seed 3303 (princesa-guerreira-v1)
- `princesa-guerreira-2.webp`: seed 3303 (princesa-guerreira-v2)
- `princesa-guerreira-3.webp`: seed 3303 (princesa-guerreira-v3)
- `princesa-guerreira-4.webp`: seed 3303 (princesa-guerreira-v4)

### Estudante da academia (`estudante-academia`, Academia mágica)

- `estudante-academia-1.webp`: seed 3303 (estudante-academia-v1)
- `estudante-academia-2.webp`: seed 3303 (estudante-academia-v2)
- `estudante-academia-3.webp`: seed 3303 (estudante-academia-v4)

### Espadachim errante (`espadachim`, Aventura)

- `espadachim-1.webp`: seed 3303 (espadachim-v1)
- `espadachim-2.webp`: seed 1101 (espadachim-v2)
- `espadachim-3.webp`: seed 3303 (espadachim-v3)
- `espadachim-4.webp`: seed 1101 (espadachim-v4)

### Rainha demônio (`rainha-demonio`, Fantasia)

- `rainha-demonio-1.webp`: seed 3303 (rainha-demonio-v1)
- `rainha-demonio-2.webp`: seed 3303 (rainha-demonio-v2)
- `rainha-demonio-3.webp`: seed 3303 (rainha-demonio-v3)
- `rainha-demonio-4.webp`: seed 3303 (rainha-demonio-v4)

### Elfa arqueira (`elfa-arqueira`, Fantasia)

- `elfa-arqueira-1.webp`: seed 3303 (elfa-arqueira-v1)
- `elfa-arqueira-2.webp`: seed 3303 (elfa-arqueira-v3)
- `elfa-arqueira-3.webp`: seed 3303 (elfa-arqueira-v4)

### Hacker de VRMMO (`hacker-vrmmo`, LitRPG / VRMMO)

- `hacker-vrmmo-1.webp`: seed 1101 (hacker-vrmmo-v2)
- `hacker-vrmmo-2.webp`: seed 3303 (hacker-vrmmo-v4)

### Sacerdotisa (`sacerdotisa`, Fantasia)

- `sacerdotisa-1.webp`: seed 3303 (sacerdotisa-v1)
- `sacerdotisa-2.webp`: seed 3303 (sacerdotisa-v2)
- `sacerdotisa-3.webp`: seed 3303 (sacerdotisa-v4)

### Cavaleiro negro (`cavaleiro-negro`, Fantasia sombria)

- `cavaleiro-negro-1.webp`: seed 3303 (cavaleiro-negro-v1)
- `cavaleiro-negro-2.webp`: seed 1101 (cavaleiro-negro-v2)
- `cavaleiro-negro-3.webp`: seed 1101 (cavaleiro-negro-v3)
- `cavaleiro-negro-4.webp`: seed 3303 (cavaleiro-negro-v4)

### Bruxa (`bruxa`, Fantasia)

- `bruxa-1.webp`: seed 1101 (bruxa-v1)
- `bruxa-2.webp`: seed 3303 (bruxa-v2)
- `bruxa-3.webp`: seed 3303 (bruxa-v3)
- `bruxa-4.webp`: seed 1101 (bruxa-v4)

### Samurai (`samurai`, Histórico japonês)

- `samurai-1.webp`: seed 1101 (samurai-v4)

### Kunoichi (`kunoichi`, Ninja)

- `kunoichi-1.webp`: seed 3303 (kunoichi-v1)
- `kunoichi-2.webp`: seed 3303 (kunoichi-v2)
- `kunoichi-3.webp`: seed 3303 (kunoichi-v3)
- `kunoichi-4.webp`: seed 1101 (kunoichi-v4)

### Monge (`monge`, Artes marciais)

- `monge-1.webp`: seed 3303 (monge-v4)

### Vampira (`vampira`, Horror gótico)

- `vampira-1.webp`: seed 1101 (vampira-v1)
- `vampira-2.webp`: seed 3303 (vampira-v2)
- `vampira-3.webp`: seed 1101 (vampira-v3)
- `vampira-4.webp`: seed 3303 (vampira-v4)

### Piloto estelar (`piloto-estelar`, Ficção científica)

- `piloto-estelar-1.webp`: seed 1101 (piloto-estelar-v4)
