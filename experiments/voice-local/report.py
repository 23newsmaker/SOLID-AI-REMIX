"""Make a self-contained listening report from the bounded local experiment."""
import base64
import html
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2] / "generated-artifacts/voice-local-test"
report = json.loads((root / "results.json").read_text())


def player(name):
    encoded = base64.b64encode((root / name).read_bytes()).decode()
    return f'<audio controls preload="none" src="data:audio/wav;base64,{encoded}"></audio>'


cards = []
for result in report["results"]:
    label = result["voice"]
    cards.append(f"""<section><h2>Suara {label}</h2>
    <p>Sampel publik asli — bukan suara DR atau anggota studio:</p>{player(f'reference-{label}.wav')}
    <p>Kalimat baru yang dihasilkan model lokal:</p>{player(result['file'])}
    <dl><dt>Durasi hasil</dt><dd>{result['audio_seconds']} detik</dd>
    <dt>Waktu proses percobaan ini</dt><dd>{result['total_seconds']} detik</dd>
    <dt>Puncak memori proses sampai titik ini</dt><dd>{result['peak_process_rss_mib']} MiB</dd></dl></section>""")

document = f"""<!doctype html><html lang="id"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Uji lokal dua suara Indonesia</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f7f4ed;color:#241a29;font:16px/1.6 system-ui,sans-serif}}
main{{max-width:960px;margin:36px auto;padding:20px}}h1{{line-height:1.2}}h2{{margin-top:0}}
.notice{{padding:18px;background:#fff0c9;border-radius:12px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin:24px 0}}
section{{padding:22px;background:white;border:1px solid #ded5c7;border-radius:14px}}
audio{{width:100%}}dt{{color:#665f68}}dd{{margin:0 0 10px;font-weight:600}}a{{color:#57326a}}small{{overflow-wrap:anywhere}}
</style><main><p>SOLID AI REMIX · EKSPERIMEN TERPISAH</p><h1>Uji lokal dua suara Indonesia</h1>
<p class="notice"><strong>Berhasil menghasilkan WAV, belum dinyatakan layak produksi.</strong>
Pengucapan dan kemiripan identitas belum dinilai manusia atau pengenal suara otomatis.
Dengarkan sampel asli dan hasil masing-masing; periksa apakah semua kata terucap dan dua suara dapat dibedakan.</p>
<h2>Naskah yang diminta</h2><blockquote>{html.escape(report['text'])}</blockquote>
<div class="grid">{''.join(cards)}</div>
<h2>Yang benar-benar diukur</h2><ul>
<li>Dijalankan lokal dengan CPU, dua thread; tidak memakai GPU atau API sintesis berbayar.</li>
<li>Model dimuat dalam {report['model_load_seconds']} detik; waktu ini terpisah dari waktu proses masing-masing sampel.</li>
<li>Kedua hasil berisi audio finite, tidak senyap, dan tidak melewati batas amplitudo pada pengukuran ini.</li>
<li>Urutan A lalu B, satu kali per sampel. B dapat memanfaatkan cache; bukan perbandingan benchmark yang adil atau jaminan kecepatan produksi.</li>
<li>Belum mengukur biaya hosting, banyak pengguna bersamaan, akurasi kata, atau kemiripan penutur.</li>
<li>Tidak membaca data aplikasi, tidak memakai rekaman pengguna, dan belum mengaktifkan fitur suara di studio.</li></ul>
<h2>Sumber dan izin</h2><p>Model <a href="https://huggingface.co/anak10thn/pocket-tts-indonesian">Pocket TTS Indonesian</a>
oleh anak10thn, berbasis Kyutai Pocket TTS dan data LEMAS, lisensi
<a href="https://creativecommons.org/licenses/by/4.0/">CC-BY-4.0</a>.
Konversi INT8 ONNX digunakan tanpa mengubah bobot.
Sampel referensi dari Common Voice 22 Indonesia, dinyatakan CC0 pada
<a href="https://huggingface.co/anak10thn/pocket-tts-indonesian/blob/main/voices/README.md">dokumentasi sampel</a>.
Hasil ini merupakan sintesis untuk evaluasi, bukan rekaman atau dukungan dari penutur asli.</p>
<small>Revisi model: {report['revision']} · ONNX Runtime {report['onnxruntime_version']} · EOS −6 · temperature 0,3 · seed 42.</small>
</main></html>"""
(root / "laporan-uji-suara.html").write_text(document)
print("Created self-contained listening report.")
