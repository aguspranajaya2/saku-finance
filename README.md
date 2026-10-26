<p align="center">
  <img src="app/icon.svg" width="72" height="72" alt="Logo Saku" />
</p>

<h1 align="center">Saku</h1>

<p align="center">
  Catat pemasukan dan pengeluaran dengan lebih teratur.<br />
  Dashboard pribadi, akun terpisah, dan pencatatan lewat Telegram.
</p>

<p align="center">
  <a href="#fitur">Fitur</a> ·
  <a href="#mulai-cepat">Mulai cepat</a> ·
  <a href="#setup-supabase">Setup Supabase</a> ·
  <a href="#integrasi-telegram">Telegram</a> ·
  <a href="#deployment">Deployment</a>
</p>

---

## Tentang Saku

Saku adalah aplikasi web untuk mencatat keuangan pribadi. Setiap pengguna dapat membuat akun sendiri, mencatat transaksi, dan melihat ringkasan pemasukan serta pengeluaran.

Aplikasi juga menyediakan integrasi bot Telegram untuk mencatat transaksi melalui pesan atau membaca foto struk. Integrasi ini dapat digunakan setelah bot dan webhook dikonfigurasi.

## Fitur

| Fitur | Yang tersedia |
| --- | --- |
| **Overview** | Ringkasan bulanan, arus kas 7 hari terakhir, kategori pengeluaran, dan transaksi terbaru. |
| **Transaksi** | Tambah transaksi, cari catatan, serta filter berdasarkan jenis dan kategori. |
| **Akun pribadi** | Pendaftaran dengan email dan pemisahan data setiap pengguna. |
| **Login username** | Masuk menggunakan username atau email dengan kata sandi yang sama. |
| **Pengaturan** | Kelola username, preferensi tampilan, dan koneksi Telegram. |
| **Bahasa** | Bahasa Inggris secara default, dengan pilihan bahasa Indonesia. |
| **Tema** | Mode terang dan gelap; pilihan disimpan di browser. |
| **Responsif** | Sidebar desktop yang bisa diciutkan dan menu drawer pada ponsel. |
| **Bot Telegram** | Catat transaksi dari chat dan baca foto struk dengan konfirmasi sebelum disimpan. |

### Teknologi

| Bagian | Teknologi |
| --- | --- |
| Framework | Next.js 16 dengan App Router dan React 19 |
| Bahasa pemrograman | TypeScript |
| Tampilan | Tailwind CSS 4 dan CSS |
| Database dan autentikasi | Supabase PostgreSQL dan Supabase Auth |
| Bot | Telegram Bot API |
| Pembacaan struk | Tesseract.js |

## Mulai cepat

**Kebutuhan:** Node.js 20.9 atau lebih baru dan pnpm. Versi package manager proyek tercantum di [package.json](package.json).

```powershell
git clone https://github.com/aguspranajaya2/saku-finance.git
cd saku-finance
pnpm install
pnpm dev
```

Buka **[http://localhost:3000](http://localhost:3000)**.

> **Coba tanpa akun:** Jika kredensial Supabase belum diisi, aplikasi menggunakan mode pratinjau dengan data contoh. Catatan pratinjau dibagikan antarhalaman dan direset saat halaman dimuat ulang.

### Halaman aplikasi

| Alamat | Halaman |
| --- | --- |
| `/` | Overview |
| `/transactions` | Daftar transaksi |
| `/settings` | Pengaturan akun dan tampilan |
| `/login` | Login dan pendaftaran |

## Setup Supabase

Setelah Supabase dihubungkan, pengguna perlu login dan transaksi disimpan ke database.

### 1. Buat proyek dan jalankan migrasi

Buat proyek di [Supabase Dashboard](https://supabase.com/dashboard). Setelah proyek siap, buka **SQL Editor** dan jalankan kedua file berikut secara berurutan:

| Urutan | File migrasi | Kegunaan |
| --- | --- | --- |
| 1 | [202610250001_initial_schema.sql](supabase/migrations/202610250001_initial_schema.sql) | Tabel transaksi, aturan akses per akun, dan tabel integrasi Telegram. |
| 2 | [202610260001_usernames.sql](supabase/migrations/202610260001_usernames.sql) | Profil pengguna, username unik, dan fungsi login username. |

Jalankan setiap migrasi satu kali. Untuk proyek yang sudah dikonfigurasi, terapkan migrasi yang belum dijalankan.

### 2. Siapkan file konfigurasi

Salin [.env.example](.env.example) menjadi `.env.local` jika file tersebut belum tersedia:

```powershell
if (-not (Test-Path .env.local)) {
    Copy-Item .env.example .env.local
}
```

Ambil **Project URL** dari panel **Connect** serta API key dari **Settings > API Keys**, lalu isi:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT-ID.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

| Variabel | Fungsi |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Alamat proyek Supabase. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Koneksi aplikasi menggunakan publishable key. |
| `SUPABASE_SECRET_KEY` | Pencocokan username secara privat di server dan akses bot Telegram. |

> **Kunci server:** `SUPABASE_SECRET_KEY` memakai key berawalan `sb_secret_...`. Simpan nilainya di `.env.local` atau environment variables hosting. File `.env.local` sudah dikecualikan oleh `.gitignore`; `.env.example` tetap berupa template kosong.

### 3. Atur autentikasi

Di **Authentication > URL Configuration**, gunakan pengaturan lokal berikut:

| Pengaturan | Nilai |
| --- | --- |
| Site URL | `http://localhost:3000` |
| Redirect URLs | `http://localhost:3000/**` |

Aktifkan penyedia **Email**, izinkan pendaftaran akun, dan atur konfirmasi email sesuai kebutuhan aplikasi.

Untuk pendaftaran pengguna umum, siapkan [custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). Pengirim email bawaan Supabase dibatasi ke alamat anggota tim proyek dan ditujukan untuk percobaan awal.

### 4. Restart dan buat akun

Restart server agar konfigurasi terbaca:

```powershell
pnpm dev
```

Buka [halaman login](http://localhost:3000/login), pilih **Create account**, lalu isi username, email, dan kata sandi. Jika konfirmasi email aktif, buka email konfirmasi sebelum masuk.

## Login dengan username

Username terdiri dari **3–30 huruf, angka, atau underscore**. Huruf besar dan kecil dianggap sama; username disimpan dalam huruf kecil.

- **Akun baru:** pilih username saat pendaftaran.
- **Akun lama:** masuk menggunakan email, buka **Settings > Account > Sign-in username**, lalu simpan username.
- **Saat login:** gunakan username atau email dengan kata sandi akun yang sama.

Email tetap digunakan untuk konfirmasi pendaftaran. Login memakai email tetap tersedia jika secret key server belum dikonfigurasi.

### Pemulihan akun

Halaman login menyediakan **Forgot password?**, **Forgot username?**, dan **Forgot email?**, dengan bahasa Inggris dan Indonesia.

- **Lupa kata sandi:** masukkan email akun, buka tautan yang dikirim Supabase di browser yang sama, lalu buat dan konfirmasi kata sandi baru.
- **Lupa username:** masuk memakai email dan kata sandi untuk melihat username di **Settings > Account**.
- **Lupa email:** masuk memakai username dan kata sandi untuk melihat email di **Settings > Account**. Jika email dan kata sandi sama-sama terlupa, pengguna perlu menemukan dan mengakses email terdaftarnya terlebih dahulu.

Di **Supabase > Authentication > URL Configuration > Redirect URLs**, tambahkan alamat callback untuk setiap lingkungan yang dipakai:

```text
http://localhost:3000/auth/callback
https://DOMAIN-APLIKASI/auth/callback
```

Ganti `DOMAIN-APLIKASI` dengan domain deployment sendiri. Pola lokal `http://localhost:3000/**` juga mencakup callback lokal. Biarkan template **Reset Password** memakai tautan bawaan `{{ .ConfirmationURL }}`. Pengiriman email mengikuti konfigurasi SMTP Supabase di atas. Tautan yang kedaluwarsa atau dibuka tanpa verifikasi browser akan diarahkan ke halaman untuk meminta tautan baru.

## Integrasi Telegram

### 1. Buat bot

Buka **[@BotFather](https://t.me/BotFather)** di Telegram, kirim `/newbot`, lalu ikuti petunjuknya.

Tambahkan konfigurasi bot ke `.env.local`:

```dotenv
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
```

| Variabel | Isi |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token bot yang diberikan BotFather. |
| `TELEGRAM_BOT_USERNAME` | Username bot tanpa karakter `@`. |
| `TELEGRAM_WEBHOOK_SECRET` | Nilai rahasia untuk memvalidasi permintaan webhook. |

Bot juga memerlukan `SUPABASE_SECRET_KEY` yang sudah diisi pada langkah Supabase.

### 2. Pasang webhook

Gunakan URL HTTPS publik untuk endpoint:

```text
https://DOMAIN-APLIKASI/api/telegram/webhook
```

Daftarkan URL tersebut melalui metode `setWebhook` pada [Telegram Bot API](https://core.telegram.org/bots/api#setwebhook). Isi `secret_token` dengan nilai yang sama seperti `TELEGRAM_WEBHOOK_SECRET`.

`localhost` belum dapat menerima pesan dari Telegram secara langsung. Gunakan domain deployment untuk koneksi bot.

### 3. Hubungkan akun

1. Login ke web Saku.
2. Buka **Settings > Telegram bot**.
3. Pilih **Create pairing code**.
4. Buka tautan Telegram yang dibuat untuk menghubungkan akun.

Kode pairing berlaku selama **10 menit** dan hanya bisa digunakan satu kali.

### Perintah bot

| Perintah | Contoh |
| --- | --- |
| Catat pengeluaran | `/catat pengeluaran 25000 Makanan makan siang` |
| Catat pemasukan | `/catat pemasukan 3000000 Gaji gaji bulanan` |
| Lihat ringkasan | `/ringkasan` |
| Baca struk | Kirim foto struk ke chat bot, lalu tinjau dan konfirmasi hasil bacanya. |

### Cara kerja pembacaan struk

Tesseract.js membaca gambar di server tanpa biaya API OCR per penggunaan. Model bahasa Indonesia dan Inggris diunduh saat pemakaian pertama.

Bot meminta konfirmasi sebelum menyimpan hasil pembacaan. Foto struk tidak disimpan ke database. Hasil OCR bergantung pada kualitas foto, sehingga detail transaksi tetap perlu diperiksa.

## Deployment

Untuk menjalankan Saku secara online:

1. Hubungkan repository ke hosting yang mendukung **Next.js dengan runtime Node.js**.
2. Isi environment variables Supabase di pengaturan hosting.
3. Isi konfigurasi Telegram jika bot akan digunakan.
4. Ubah **Site URL** Supabase ke domain aplikasi dan tambahkan URL redirect yang sesuai.
5. Siapkan custom SMTP untuk email autentikasi pengguna umum.
6. Daftarkan webhook Telegram menggunakan domain HTTPS aplikasi.

Satu deployment dapat digunakan banyak pengguna. Setiap orang mendaftar melalui `/login` dan memiliki catatan transaksi sendiri.

## Struktur proyek

```text
app/
  (workspace)/       Halaman overview, transaksi, dan pengaturan
  api/auth/          Endpoint login username atau email
  api/telegram/      Pairing akun dan webhook bot
  login/             Halaman login dan pendaftaran
  globals.css        Gaya aplikasi dan layout responsif
  icon.svg           Logo untuk tab browser
components/          Komponen antarmuka dan state bersama
lib/
  supabase/          Koneksi Supabase untuk browser dan server
  receipts/          Pembacaan dan pengolahan struk
supabase/
  migrations/        Skema database dan kebijakan akses
.env.example         Template variabel lingkungan
```

<details>
<summary><strong>Catatan teknis: akses data dan autentikasi</strong></summary>

- Transaksi terhubung ke akun melalui `user_id`. Kebijakan **Row Level Security** membatasi akses pengguna ke catatannya sendiri.
- Profil username hanya dapat dibaca dan diperbarui oleh pemilik akun. Polanya mengikuti [panduan pengelolaan pengguna Supabase](https://supabase.com/docs/guides/auth/managing-user-data).
- Pencocokan username ke email dijalankan di server. Endpoint login tidak mengembalikan email dari pencocokan tersebut kepada browser.
- Secret key Supabase dan token bot dipakai pada kode server.
- Endpoint login memakai respons umum untuk kredensial yang salah, pemeriksaan origin, dan pembatasan percobaan per proses. Deployment dengan banyak instance memerlukan pembatasan bersama pada hosting atau edge.

</details>

<details>
<summary><strong>Referensi antarmuka</strong></summary>

- [Dashboard Monarch](https://www.monarchmoney.com/customizable-dashboard-manual-transactions): penempatan informasi penting pada halaman ringkasan.
- [Spending Trends YNAB](https://support.ynab.com/en_us/spending-trends-H1inlhzAc): alur ringkasan kategori dan penelusuran transaksi.

Saku mengadaptasi pola tersebut menjadi halaman terpisah, ruang konten yang lebih lebar, sidebar yang bisa diciutkan, dan daftar transaksi berbentuk kartu pada layar ponsel.

</details>
