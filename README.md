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
| **Overview** | Pendapatan, beban, laba/rugi, kas, kewajiban, piutang, dan arus kas 7 hari dari jurnal yang sama. |
| **Jurnal umum** | Pencatatan praktis atau jurnal manual 2–20 baris, filter tanggal/akun/jenis, serta jurnal pembalik. |
| **Akun & buku besar** | Daftar akun aset, kewajiban, ekuitas, pendapatan, beban; saldo awal dan saldo berjalan per akun. |
| **Utang & piutang** | Akun per orang/pinjaman/kartu, cicilan sebagian, penerimaan piutang, dan riwayat mutasi. |
| **Laporan keuangan** | Laba rugi periode, neraca saldo, dan neraca per tanggal dengan pemeriksaan keseimbangan. |
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

**Kebutuhan:** Node.js **22.23.4+ pada jalur 22 LTS** atau **24.22.1+ pada jalur 24 LTS**, serta pnpm. Versi lokal acuan ada di [.node-version](.node-version); versi package manager tercantum di [package.json](package.json).

```powershell
git clone https://github.com/aguspranajaya2/saku-finance.git
cd saku-finance
pnpm install
pnpm dev
```

Buka **[http://localhost:3000](http://localhost:3000)**.

Untuk memeriksa build produksi, jalankan `pnpm build`. Pada Windows, bila Turbopack memunculkan error proses `node process exited before we could connect`, gunakan opsi Webpack yang disediakan Next.js dengan Node LTS yang memenuhi versi di atas:

```powershell
pnpm build --webpack
```

> **Coba tanpa akun:** Jika kredensial Supabase belum diisi, aplikasi menggunakan mode pratinjau dengan data contoh. Catatan pratinjau dibagikan antarhalaman dan direset saat halaman dimuat ulang.

### Halaman aplikasi

| Alamat | Halaman |
| --- | --- |
| `/` | Overview |
| `/transactions` | Jurnal umum dan riwayat koreksi |
| `/accounts` | Daftar akun, saldo awal, dan buku besar |
| `/debts` | Utang, kartu kredit, dan piutang |
| `/reports` | Laba rugi, neraca saldo, dan neraca |
| `/settings` | Pengaturan akun dan tampilan |
| `/login` | Login dan pendaftaran |

## Setup Supabase

Setelah Supabase dihubungkan, pengguna perlu login dan transaksi disimpan ke database.

### 1. Buat proyek dan jalankan migrasi

Buat proyek di [Supabase Dashboard](https://supabase.com/dashboard). Setelah proyek siap, buka **SQL Editor** dan jalankan file berikut secara berurutan:

| Urutan | File migrasi | Kegunaan |
| --- | --- | --- |
| 1 | [202610250001_initial_schema.sql](supabase/migrations/202610250001_initial_schema.sql) | Tabel transaksi, aturan akses per akun, dan tabel integrasi Telegram. |
| 2 | [202610260001_usernames.sql](supabase/migrations/202610260001_usernames.sql) | Profil pengguna, username unik, dan fungsi login username. |
| 3 | [202610260002_security_hardening.sql](supabase/migrations/202610260002_security_hardening.sql) | Izin kolom transaksi, pencabutan koneksi bot, otorisasi struk, batas permintaan bersama, dan slot OCR. |
| 4 | [202610270001_double_entry_ledger.sql](supabase/migrations/202610270001_double_entry_ledger.sql) | Akun, jurnal berpasangan, saldo awal, pembalik/penutup, migrasi transaksi lama, dan perintah pembukuan Telegram. |
| 5 | [202610270002_decimal_amounts.sql](supabase/migrations/202610270002_decimal_amounts.sql) | Nominal dengan dua desimal secara tepat pada jurnal, saldo awal, Telegram, dan struk. Nilai lama tetap dalam rupiah. |

Jalankan setiap migrasi satu kali. Untuk proyek yang sudah dikonfigurasi, terapkan migrasi yang belum dijalankan.

> **Pembaruan dari versi lama:** jalankan migrasi keamanan nomor 3 **sebelum** deploy kode baru. Migrasi menambahkan fungsi yang dibutuhkan pembatasan login dan bot; layanan menolak memproses permintaan jika kontrol keamanan ini belum tersedia. Push Git tidak menjalankan migrasi Supabase secara otomatis.

> **Pembaruan jurnal berpasangan:** jika migrasi 1–3 sudah dijalankan, cukup jalankan **migrasi 4 sebelum push/deploy versi pembukuan**. Migrasi 4 dijalankan satu kali dalam transaksi database, membuat akun awal untuk pengguna lama, dan membawa transaksi lama ke jurnal. Web versi baru membutuhkan tabel/fungsi ini. Push Git tidak menjalankan SQL.

> **Pembaruan dua desimal:** jika migrasi 1–4 sudah dijalankan, cukup jalankan **migrasi 5 satu kali sebelum push/deploy pembaruan desimal**. Kolom nominal berubah menjadi `numeric` dengan pemeriksaan maksimal dua desimal, tanpa pembulatan. Transaksi Rp30.000 tetap Rp30.000. Hak akses per pengguna dan pemeriksaan keseimbangan jurnal tetap berlaku. Nominal dikirim sebagai teks desimal dan dihitung dengan integer seperseratus rupiah agar pecahan tidak hilang.

Tombol **mata** di bilah atas menyembunyikan saldo, nominal jurnal, buku besar, utang/piutang, dan laporan. Grafik beserta tooltip nominal ikut disembunyikan. Pilihan tersimpan di browser dan berlaku antarhalaman; pada kunjungan pertama nominal tersembunyi. Nominal yang sedang diketik dalam formulir dan pesan Telegram tetap terlihat. Ini adalah privasi tampilan, bukan pengganti login atau pengaturan akses data.

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

## Pembukuan debit–kredit

Saku menggunakan jurnal berpasangan dalam **IDR bulat**. Setiap jurnal mempunyai 2–20 baris, minimal dua akun berbeda, dan total debit sama dengan kredit. Posting disimpan secara atomik; tabel jurnal hanya dapat dibaca oleh pemiliknya. Penulisan dilakukan melalui fungsi yang mengambil identitas dari sesi pengguna. Saldo laporan dijumlahkan dengan `BigInt`, termasuk jika total banyak transaksi melampaui batas angka aman JavaScript.

### Akun awal

| Kode | Akun | Jenis / saldo normal |
| --- | --- | --- |
| `1000` | Kas | Aset / debit |
| `1010` | Bank | Aset / debit |
| `1100` | Piutang | Aset / debit |
| `2000` | Utang | Kewajiban / kredit |
| `2100` | Kartu kredit | Kewajiban / kredit |
| `3000` | Modal awal | Ekuitas / kredit |
| `4000` | Pendapatan | Pendapatan / kredit |
| `5000` | Beban | Beban / debit |

Buat akun sendiri di **Accounts & ledger / Akun & buku besar**. Misalnya `1110 Piutang Budi`, `2010 Utang Rina`, `1020 Bank BCA`, `4010 Gaji`, atau `5010 Administrasi`. Pilih rincian **Piutang** untuk peminjam, **Utang** untuk pemberi pinjaman, dan **Kartu kredit / paylater** untuk kartu agar saldo tampil pada halaman utang/piutang. Kode akun harus unik per pengguna.

Saldo awal dapat diisi ketika membuat akun aset/kewajiban atau melalui tombol **Opening balance / Saldo awal** pada akun yang sudah ada. Masukkan saldo sebelum aktivitas pertamanya. Aplikasi membuat jurnal dengan lawan ekuitas; saldo awal tidak dihitung sebagai pendapatan, beban, atau arus kas periode. Saldo negatif diperbolehkan dan ditampilkan sebagai saldo pada sisi berlawanan.

### Pencatatan praktis dan jurnal manual

| Aktivitas | Debit | Kredit |
| --- | --- | --- |
| Pemasukan tunai | Kas / bank | Pendapatan |
| Pengeluaran tunai atau kartu debit | Beban | Kas / bank |
| Pembelian kartu kredit/paylater | Beban | Kartu kredit / kewajiban |
| Terima pinjaman | Kas / bank | Utang |
| Berikan pinjaman | Piutang | Kas / bank |
| Bayar pokok/cicilan utang | Utang / kartu kredit | Kas / bank |
| Terima pelunasan piutang | Kas / bank | Piutang |
| Transfer rekening sendiri | Kas / bank tujuan | Kas / bank asal |
| Setoran modal | Kas / bank | Ekuitas |
| Penarikan modal/prive | Ekuitas | Kas / bank |

Pilih **Record activity / Catat aktivitas** untuk pola di atas, atau **Manual journal / Jurnal manual** untuk penjualan kredit, tagihan belum dibayar, akrual, penyesuaian, serta pemecahan beberapa akun. Contoh cicilan dengan bunga: debit Utang 100.000, debit Beban bunga 20.000, dan kredit Bank 120.000. Cicilan sebagian mengurangi saldo pokok sesuai nominal yang dicatat. Bunga, jadwal jatuh tempo, kurs valuta asing, pajak, dan sinkronisasi bank tidak dihitung otomatis.

Pembayaran pokok pinjaman, penerimaan kembali piutang, dan transfer rekening sendiri tidak menambah pendapatan/beban. Belanja kredit dicatat sebagai beban saat pembelian; pelunasan kartunya mengurangi utang. Pola pemisahan pembelian dan pembayaran kartu juga digunakan dalam [Actual Budget](https://actualbudget.org/docs/budgeting/credit-cards/).

### Koreksi, penutup, dan laporan

Jurnal yang sudah diposting tidak diedit atau dihapus melalui UI. Buka rincian jurnal lalu gunakan **Post reversal / Buat jurnal pembalik**, pilih tanggal pembalik, dan buat jurnal pengganti bila perlu. Riwayat asli tetap tersimpan; laporan per tanggal memperhitungkan tanggal efektif pembalik.

Pada jurnal manual, pilih tujuan **Closing / Penutup** untuk memindahkan pendapatan/beban ke ekuitas/laba ditahan. Jurnal penutup hanya menerima akun pendapatan, beban, dan ekuitas. Laporan laba rugi mengecualikan jurnal penutup beserta pembaliknya; neraca saldo serta neraca tetap memperhitungkannya. Proses penutupan dilakukan manual, tanpa mengunci periode otomatis.

Transaksi dari versi lama serta konfirmasi struk belanja di bot masuk melalui jalur kompatibilitas dan otomatis menjadi jurnal **Kas**. Untuk bank/kredit, pilih Batal dan gunakan jurnal dengan rekening yang benar. Bukti transfer bank memakai alur terpisah: hasil baca ditampilkan tanpa disimpan sebagai pengeluaran kas. Pembaruan/penghapusan melalui jalur lama membuat pembalik pada tanggal transaksi aslinya.

### Mengoreksi transaksi yang salah

1. Buka **General journal / Jurnal umum**, cari transaksi, lalu pilih **Correct / reverse / Koreksi / balik jurnal**.
2. Periksa jurnal dan tanggal pembalik. Untuk kesalahan input, tanggal asli membatalkan dampaknya pada periode yang sama.
3. Simpan pembalik. Nominal yang salah dinetralkan; jurnal asli tetap ada untuk riwayat audit.
4. Jika transaksi sebenarnya terjadi, pilih **Record activity / Catat aktivitas** dan simpan penggantinya satu kali dengan nominal, tanggal, jenis, dan akun yang benar. Jika transaksi duplikat, cukup buat pembalik.

Jangan menambahkan transaksi bernilai negatif untuk mengoreksi. Jurnal yang sudah dibalik tidak dapat dibalik lagi.


## Login dengan username

Username terdiri dari **3–30 huruf, angka, atau underscore**. Huruf besar dan kecil dianggap sama; username disimpan dalam huruf kecil.

- **Akun baru:** pilih username saat pendaftaran.
- **Akun lama:** masuk menggunakan email, buka **Settings > Account > Sign-in username**, lalu simpan username.
- **Saat login:** gunakan username atau email dengan kata sandi akun yang sama.

Email tetap digunakan untuk konfirmasi pendaftaran. Login email maupun username menggunakan pembatasan percobaan bersama di server dan membutuhkan konfigurasi server Supabase serta migrasi keamanan.

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

Gunakan **Disconnect Telegram** di Settings untuk mencabut koneksi bot. Pemutusan atau pemindahan koneksi juga membatalkan kode pairing dan struk tertunda yang berkaitan; tombol struk dari chat lama tidak dapat menyimpan transaksi setelah koneksinya dicabut.

### Perintah bot

| Perintah | Contoh |
| --- | --- |
| Catat pengeluaran | `/catat pengeluaran 25000 Makanan makan siang` |
| Catat pemasukan | `/catat pemasukan 3000000 Gaji gaji bulanan` |
| Terima pinjaman ke Kas | `/catat utang 1jt Pinjaman dari Rina` |
| Berikan pinjaman dari Kas | `/catat piutang 300rb Pinjaman ke Budi` |
| Bayar utang dari Kas | `/catat bayar_utang 100rb Cicilan bayar pokok` |
| Terima piutang ke Kas | `/catat terima_piutang 50rb Pinjaman angsuran Budi` |
| Belanja dengan Bank / kartu debit | `/catat kartu_debit 30ribu Makanan makan siang` |
| Belanja dengan kartu kredit | `/catat kartu_kredit 200rb Belanja belanja bulanan` |
| Bayar kartu dari Bank | `/catat bayar_kartu 100rb Cicilan bayar kartu` |
| Transfer Kas ke Bank | `/catat transfer 100rb Transfer setor ke bank` |
| Setoran / penarikan modal | `/catat modal 1jt Modal setoran` atau `/catat prive 100rb Modal penarikan` |
| Jurnal dua akun pilihan sendiri | `/jurnal 1010 2010 1jt Pinjaman Rina masuk bank` |
| Daftar akun / saldo utang / piutang | `/akun`, `/utang`, `/piutang` |
| Lihat ringkasan | `/ringkasan` |
| Baca struk | Kirim foto struk atau file gambar JPG/PNG/WebP (maks. 20 MB), lalu tinjau dan konfirmasi hasil bacanya. |

`/jurnal` memakai urutan **kode debit, kode kredit, nominal, keterangan**. Gunakan kode akun milikmu dari `/akun`. Jurnal dengan lebih dari dua baris atau jurnal penutup dibuat melalui web. Ringkasan bot memakai jurnal yang sama dengan laporan web.

Nominal menerima `30000`, `30.000`, `30,000`, `30rb`, `30ribu`, `30k`, dan `1,5jt`/`1.5jt`. Maksimal dua desimal dapat ditulis sebagai `3681341.75`, `3681341,75`, `3.681.341,75`, atau `3,681,341.75`. Angka seperti `1.234` tetap berarti 1234 (pemisah ribuan). Lebih dari dua desimal dan karakter asing ditolak tanpa membulatkan nominal. Contoh: `/catat pemasukan 3681341.75 Gaji gaji bulanan`. Pesan percakapan bebas seperti `Buat SKCK 30ribu` masih membutuhkan format `/catat`.

### Cara kerja pembacaan struk

Tesseract.js membaca gambar di server tanpa biaya API OCR per penggunaan. Model bahasa Indonesia dan Inggris diunduh saat pemakaian pertama.

Bot meminta konfirmasi sebelum menyimpan hasil pembacaan. Foto struk tidak disimpan ke database. Hasil OCR bergantung pada kualitas foto, sehingga detail transaksi tetap perlu diperiksa.

**Bukti transfer bank:** parser memprioritaskan label `Transfer Amount` / `Nominal Transfer`, membaca tanggal seperti `29 Oct 2026` dan nama penerima. Nomor rekening dan referensi tidak digunakan sebagai nominal. Hasil ambigu, mata uang asing, atau transfer gagal/tertunda tidak menghasilkan nominal siap simpan. Ini bukan verifikasi keaslian bukti atau konfirmasi ke bank.

Bot menampilkan draf transfer dan contoh perintah, tanpa tombol konfirmasi pengeluaran kas. Tujuan transfer harus ditentukan pengguna: belanja, pembayaran pokok utang, pinjaman/piutang, atau antar rekening sendiri. Lihat kode akun lewat `/akun`. Tanggal bukti dapat ditulis pada jurnal manual:

```text
/jurnal 5000 1010 11000 @2026-10-29 Bayar belanja
```

`@YYYY-MM-DD` bersifat opsional; tanpa tanggal, bot memakai tanggal hari ini. Kode `5000` dan `1010` hanya contoh akun Beban dan Bank bawaan; sesuaikan dengan rekening sebenarnya. Jangan mengirim perintah pencatatan lagi untuk transaksi yang sudah disimpan.

**Unggah dari web:** buka Jurnal umum → **Read proof / Baca bukti**, unggah JPG/PNG/WebP maksimal **4 MB**, lalu periksa draf. Pilih aktivitas, akun debit/kredit, nominal, dan tanggal sebelum **Post journal / Simpan jurnal**. Tidak ada jurnal yang dibuat saat gambar dibaca. Endpoint hanya menerima pengguna terautentikasi dan permintaan dari origin yang sama; ada batas bersama 3 pembacaan/menit dan 20/hari per akun di web, serta 10/menit untuk seluruh web. Worker proses yang sama dibatasi dua. Telegram mempertahankan batas dan lease OCR sendiri. Gambar serta teks OCR mentah tidak disimpan dalam database.

Gambar dapat dikirim sebagai **Photo** maupun **File/Document** di Telegram. Isi file diperiksa sebelum OCR; PDF dan format selain JPG, PNG, atau WebP akan mendapat petunjuk format yang didukung. Gambar dibatasi **20 megapixel**, sisi maksimal **10.000 pixel**, dan satu frame; gambar dinormalisasi sebelum dibaca.

Konfigurasi build menyertakan worker dan berkas WASM Tesseract untuk deployment. OCR dibatasi 45 detik dan menyimpan cache model di folder sementara server.

Pembacaan struk dibatasi **3 per menit dan 20 per hari per akun**, dengan maksimal **2 job aktif** bersama di database. Penghitung dan lease pekerjaan berlaku antar instance server; pesan Telegram yang sama tidak memulai OCR berulang.

Jalankan `pnpm test` untuk menguji alur bot, normalisasi gambar, sesi, header, pembatasan permintaan, serta migrasi dan isolasi dua akun menggunakan PostgreSQL lokal PGlite. Pengujian ini tidak membutuhkan akun atau data Supabase produksi. CI menjalankan tes, build, dan audit dependency pada push/PR; Dependabot menyiapkan pembaruan dependency untuk ditinjau.

### Keamanan operasional

Aplikasi membatasi izin kolom transaksi dan akses per akun, memakai CSP dengan nonce per request, menolak framing, dan mengosongkan data browser ketika identitas sesi berubah. Rahasia server tetap berada di environment variables. Data struk dan pesan yang dikirim lewat Telegram tetap melewati layanan Telegram.

Pengelola tetap perlu mengaktifkan MFA pada akun GitHub/Vercel/Supabase/Telegram, memeriksa Supabase Security Advisor serta kebijakan kata sandi/CAPTCHA, menguji backup dan restore, dan memantau log/kuota hosting. Versi runtime lokal tidak menentukan versi patch runtime Vercel; pastikan hosting menggunakan jalur Node LTS yang didukung. Rekomendasi provider: [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).

Pembatasan IP mengandalkan header `x-forwarded-for` yang ditulis ulang oleh proxy hosting tepercaya. Jika memakai hosting selain Vercel, atur reverse proxy agar pengunjung tidak dapat menentukan header IP tersebut sendiri. Batas per akun tetap berlaku terpisah dari batas IP.

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
- Endpoint login memakai respons umum untuk kredensial yang salah, pemeriksaan origin, serta pembatasan percobaan bersama di database berdasarkan IP dan identitas akun. Pengamanan Supabase Auth seperti CAPTCHA dan batas permintaan provider tetap perlu dikonfigurasi.

</details>

<details>
<summary><strong>Referensi antarmuka</strong></summary>

- [Dashboard Monarch](https://www.monarchmoney.com/customizable-dashboard-manual-transactions): penempatan informasi penting pada halaman ringkasan.
- [Spending Trends YNAB](https://support.ynab.com/en_us/spending-trends-H1inlhzAc): alur ringkasan kategori dan penelusuran transaksi.

Saku mengadaptasi pola tersebut menjadi halaman terpisah, ruang konten yang lebih lebar, sidebar yang bisa diciutkan, dan daftar transaksi berbentuk kartu pada layar ponsel.

</details>
