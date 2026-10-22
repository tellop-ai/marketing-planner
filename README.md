# Marketing planner

Plan, write and ready your social media posts in one place: a month calendar and a week list to schedule from, words fitted to each platform, pictures made with AI or from your own photos in your brand colours, swipe posts, stories and video plans, special days, ideas, ready answers, customers, consent-based contact lists and results led by customers and sales. You share each post yourself. Ideas from Mixpost Lite and testimonials (both MIT).

This app was made with Tellop, the app builder by Pathnomic Labs, on Tellop's
starting kit: Next.js and React, with Node's own SQLite for what the app keeps.
It is published under the Apache License 2.0 (`LICENSE`).

## Run it outside Tellop

You need Node.js 24 and pnpm 11.

```sh
pnpm install
pnpm dev
```

Then open <http://localhost:3000>. For the finished app, run `pnpm build` and
then `pnpm start`.

## Where the app keeps things

- What people save in the app goes into `.data/app.db`.
- Photos and files that people add go into `.data/files/`. Inside Tellop,
  Tellop keeps them for the app; outside Tellop they are ordinary files in that
  folder, so keep a copy of `.data/` when you keep a copy of the app.
- Outside Tellop, a photo or a video shows only in a browser that can show it
  as it is (Safari shows an iPhone's HEIC photos; Chrome does not). In other
  browsers the app offers the original as a download.
- `.data/` is never part of this repository: `.gitignore` leaves it out, and
  the app starts empty.

## Private values

The app never reads a private value, such as a password or a service key, from
a file, and it refuses to start while a `.env` file exists
(`lib/guard-no-plaintext-secrets.mjs`). Give a private value to the app as an
environment variable when you start it.

## Test it

```sh
pnpm test
```

## Türkçe

Bu uygulama, Pathnomic Labs'in uygulama yapıcısı Tellop ile, Tellop'un başlangıç
kitinin üzerinde yapıldı. Apache License 2.0 ile yayımlanır (`LICENSE`).

Tellop dışında çalıştırmak için Node.js 24 ve pnpm 11 gerekir:

```sh
pnpm install
pnpm dev
```

Sonra <http://localhost:3000> adresini açın. Bitmiş uygulama için önce
`pnpm build`, sonra `pnpm start` komutunu çalıştırın.

- İnsanların uygulamaya kaydettikleri `.data/app.db` dosyasında durur.
- Eklenen fotoğraflar ve dosyalar `.data/files/` klasöründe durur. Tellop
  içinde onları Tellop saklar; Tellop dışında o klasördeki sıradan dosyalardır.
  Uygulamanın bir kopyasını saklarken `.data/` klasörünün de kopyasını saklayın.
- Tellop dışında bir fotoğraf ya da video, yalnızca onu olduğu gibi gösterebilen
  bir tarayıcıda görünür (Safari iPhone'un HEIC fotoğraflarını gösterir, Chrome
  göstermez). Diğer tarayıcılarda uygulama, aslını indirilecek bir dosya olarak
  sunar.
- `.data/` bu depoya hiç girmez (`.gitignore` onu dışarıda bırakır) ve
  uygulama boş başlar.
- Uygulama gizli bir değeri (bir parola ya da bir servis anahtarı) dosyadan
  okumaz ve bir `.env` dosyası varken açılmaz. Gizli bir değeri, uygulamayı
  başlatırken bir ortam değişkeni olarak verin.
