# Avatares do Oghma (estilo minimalista)

22 avatares de personagens de light/web novels: formas de cor sólida, sem contorno e sem rosto, fundo liso. Fan art para uso pessoal, só SFW. Gerados no ComfyUI do PC Windows (DESKTOP-2MAHMQM).

- `<id>.webp`: 512 px, quadrado, pronto para recorte em círculo (rosto centralizado, mesmo tamanho em todos).
- `folha.png`: todos lado a lado, já em círculo.
- Saíram do conjunto: `ainz`, `shadow` (não ficaram bons) e `sunny` (o modelo não conhece; trocado por `kurumi`).

## Como foram feitos

- Modelo: `cagliostrolab/animagine-xl-4.0` (`animagine-xl-4.0-opt.safetensors`), 1024×1024, euler_ancestral, 28 passos, CFG 5.
- LoRA de estilo: Minimalist / Vector Art (Civitai 91880, `Minimalist-IL-v1-08.safetensors`), peso 0,8, gatilho `ChopioM1nimalist`.
- Pose fixa de busto com ControlNet OpenPose SDXL (xinsir), força 1,0 até 90% da geração, nos marcados abaixo.
- Enquadramento padronizado depois da geração: o rosto (mancha lisa cor de pele) é medido e a imagem é reescalada para o rosto ocupar 24% da largura com o centro a 46% da altura.
- Gerador: `C:\Users\Jandson\Projects\oghma-avatares-gen` (`gerar.py`, `normaliza.py`, `exportar.py`).

## Negativo

```text
(lineart:1.4), (outline:1.3), (eyes:1.3), mouth, nose, (shading:1.3), gradient, (detailed:1.3), texture, highlights, cel shading, sketch, text, watermark, signature, logo, frame, border, multiple views, (close-up:1.4), (head out of frame:1.4), (cropped head:1.3), (hat out of frame:1.3), (from behind:1.4), (yellow skin:1.3), (white skin:1.2), grey skin, pink skin, colored skin, heart, (silhouette:1.2), backlighting, dark face, (scenery:1.3), (detailed background:1.4), (background pattern:1.3), snowflakes, stars, plants, particles, (intricate details:1.3), ornate, nsfw, nude, cleavage, blurry, worst quality, low quality, low score, bad score, average score
```

## Cada avatar

### albedo (Albedo, Overlord)

Seed 3303.

```text
ChopioM1nimalist, 1girl, albedo \(overlord\), overlord \(maruyama\), safe, long hair, black hair, white horns, black wings, white dress, (plain purple background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### asuna (Asuna, Sword Art Online)

Seed 3303.

```text
ChopioM1nimalist, 1girl, asuna \(sao\), sword art online, safe, long hair, orange hair, white and red outfit, (plain red background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### ayanokouji (Kiyotaka Ayanokouji, Classroom of the Elite)

Seed 1101.

```text
ChopioM1nimalist, 1boy, ayanokouji kiyotaka, youkoso jitsuryoku shijou shugi no kyoushitsu e, safe, light brown hair, short hair, red school blazer, necktie, (plain light grey background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### betelgeuse (Betelgeuse, Re:Zero)

Seed 1101.

```text
ChopioM1nimalist, 1boy, petelgeuse romaneeconti, re:zero kara hajimeru isekai seikatsu, safe, green hair, bob cut, black robe, hands up, head tilt, (plain lime green background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### elaina (Elaina, Wandering Witch)

Seed 3303.

```text
ChopioM1nimalist, 1girl, elaina \(majo no tabitabi\), majo no tabitabi, safe, long hair, grey hair, black witch hat, black robe, (plain sky blue background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### emilia (Emilia, Re:Zero)

Seed 3303.

```text
ChopioM1nimalist, 1girl, emilia \(re:zero\), re:zero kara hajimeru isekai seikatsu, safe, long hair, silver hair, pointy ears, white flower hair ornament, white and purple dress, (plain lavender background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### holo (Holo, Spice and Wolf)

Seed 3303.

```text
ChopioM1nimalist, 1girl, holo, spice and wolf, safe, long hair, brown hair, wolf ears, pouch necklace, (plain golden yellow background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### horikita (Suzune Horikita, Classroom of the Elite)

Seed 1101.

```text
ChopioM1nimalist, 1girl, horikita suzune, youkoso jitsuryoku shijou shugi no kyoushitsu e, safe, long hair, black hair, side braid, red school blazer, (plain slate blue background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### kim-dokja (Kim Dokja, Omniscient Reader's Viewpoint)

Seed 4404; pose fixa, LoRA de personagem char-kimdokja.safetensors (Civitai 608497).

```text
ChopioM1nimalist, 1boy, kim dokja, omniscient reader's viewpoint, safe, black hair, short hair, white long coat, black shirt, (plain midnight blue background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### kirito (Kirito, Sword Art Online)

Seed 1101.

```text
ChopioM1nimalist, 1boy, kirito, sword art online, safe, black hair, black coat, two swords on back, (plain teal background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### klein-moretti (Klein Moretti, Lord of the Mysteries)

Seed 3303.

```text
ChopioM1nimalist, 1boy, klein moretti, lord of the mysteries, safe, black hair, black top hat, black coat, white shirt, (plain grey background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### kurumi (Kurumi Tokisaki, Date A Live)

Seed 1101; pose fixa.

```text
ChopioM1nimalist, 1girl, tokisaki kurumi, date a live, safe, black hair, twintails, red and black gothic dress, (plain crimson background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### mai (Mai Sakurajima, Bunny Girl Senpai)

Seed 4404; pose fixa, LoRA de personagem char-mai.safetensors (Civitai 1189072).

```text
ChopioM1nimalist, 1girl, sakurajima mai, seishun buta yarou, safe, long hair, black hair, rabbit ears hairband, black dress, white collar, (plain dusk purple background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### megumin (Megumin, Konosuba)

Seed 1101.

```text
ChopioM1nimalist, 1girl, megumin, kono subarashii sekai ni shukufuku wo!, safe, short hair, brown hair, witch hat, eyepatch, red cape, (plain orange background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### naofumi (Naofumi Iwatani, Shield Hero)

Seed 3303.

```text
ChopioM1nimalist, 1boy, iwatani naofumi, tate no yuusha no nariagari, safe, black hair, short hair, green cloak, round shield, (plain green background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### raphtalia (Raphtalia, Shield Hero)

Seed 3303.

```text
ChopioM1nimalist, 1girl, raphtalia, tate no yuusha no nariagari, safe, long hair, brown hair, raccoon ears, katana, (plain orange red background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### rem (Rem, Re:Zero)

Seed 3303.

```text
ChopioM1nimalist, 1girl, rem \(re:zero\), re:zero kara hajimeru isekai seikatsu, safe, blue hair, short hair, maid headdress, maid, (plain pink background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### roxy (Roxy Migurdia, Mushoku Tensei)

Seed 1101.

```text
ChopioM1nimalist, 1girl, roxy migurdia, mushoku tensei, safe, blue hair, twin braids, brown witch hat, brown robe, (plain sky blue background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### subaru (Natsuki Subaru, Re:Zero)

Seed 3303.

```text
ChopioM1nimalist, 1boy, natsuki subaru, re:zero kara hajimeru isekai seikatsu, safe, black hair, short hair, black track jacket, orange trim, (plain orange background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### sung-jinwoo (Sung Jinwoo, Solo Leveling)

Seed 3303.

```text
ChopioM1nimalist, 1boy, sung jin-woo, ore dake level up na ken, safe, black hair, messy hair, black long coat, high collar, (purple aura:1.3), (plain navy blue background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### violet (Violet Evergarden, Violet Evergarden)

Seed 1101.

```text
ChopioM1nimalist, 1girl, violet evergarden, violet evergarden \(series\), safe, blonde hair, braided bun, red hair ribbon, blue jacket, green brooch, (plain steel blue background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```

### wei-wuxian (Wei Wuxian, Mo Dao Zu Shi)

Seed 3303.

```text
ChopioM1nimalist, 1boy, wei wuxian, mo dao zu shi, safe, long hair, black hair, high ponytail, red hair ribbon, black robe, black flute, (plain crimson background:1.3), (minimalism:1.4), (flat color:1.4), (no lineart:1.4), (faceless:1.3), no eyes, no mouth, (light skin:1.1), facing viewer, vector art, simple shapes, solid colors, (vibrant colors:1.2), (simple background:1.3), solid color background, (upper body:1.2), centered, (full head visible:1.2), headroom, head tilt, masterpiece, high score, absurdres
```
