"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";

/**
 * Giriş ekranı.
 *
 * NOT: Buradaki "1-tıkla demo hesap" kartları kaldırılmıştır. Kurumsal
 * kullanıcı listesini (isim, rol, e-posta, mağaza yetkisi) giriş yapılmamış
 * herkese göstermek hem kişisel veri ifşasıdır hem de saldırgana geçerli
 * hesap listesi verir. Hesaplar Admin Paneli → Kullanıcı Yönetimi'nden açılır.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        router.push("/");
        router.refresh();
      } else {
        // Hesabın var olup olmadığını sızdırmayan tek tip mesaj
        setErrorMsg(data.error || "E-posta veya parola hatalı.");
        setLoading(false);
      }
    } catch {
      setErrorMsg("Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-base aurora">
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-2">
        {/* Sol: marka anlatısı — yalnız geniş ekranda */}
        <section className="relative hidden flex-col justify-between p-12 lg:flex">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-brand via-info to-positive shadow-xl shadow-brand/25">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="font-display text-lg font-bold tracking-tight text-ink">CERBERUS</div>
              <div className="font-mono-tech text-[11px] text-ink-faint">
                Karar Merkezli Ticaret İşletim Sistemi
              </div>
            </div>
          </div>

          <div className="max-w-md space-y-6">
            <h2 className="font-display text-3xl font-bold leading-tight tracking-tight text-ink">
              Her sayının arkasında
              <br />
              <span className="text-brand-soft">gerçek bir sorgu</span> var.
            </h2>
            <p className="text-[15px] leading-relaxed text-ink-muted">
              Tedarik keşfinden depo sayımına, landed-cost kârlılığından FBA sevkiyatına kadar
              tüm operasyon tek panelde. Sistem bilmediği şeyi tahmin etmez.
            </p>

            <ul className="space-y-3 font-mono-tech text-[12px] text-ink-muted">
              {[
                "Açıklanabilir iş sağlığı skoru — kırılımıyla birlikte",
                "Mağaza bazlı veri izolasyonu, sunucu tarafında zorlanır",
                "40 kolonluk sipariş şeması ve Drive/Excel içe aktarma",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-positive" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div className="font-mono-tech text-[10px] text-ink-faint">
            © {new Date().getFullYear()} Cerberus Commerce — Erişim rol ve mağaza kapsamıyla korunur.
          </div>
        </section>

        {/* Sağ: form */}
        <section className="flex items-center justify-center p-6 sm:p-10">
          <div className="w-full max-w-sm">
            {/* Mobil marka */}
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand via-info to-positive">
                <ShieldCheck className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="font-display text-base font-bold text-ink">CERBERUS</div>
                <div className="font-mono-tech text-[10px] text-ink-faint">Ticaret İşletim Sistemi</div>
              </div>
            </div>

            <div className="mb-7">
              <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
                Oturum açın
              </h1>
              <p className="mt-1.5 text-[13px] text-ink-muted">
                Yetkilendirildiğiniz mağazanın paneline erişin.
              </p>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-3 text-[12px] text-danger"
              >
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block font-mono-tech text-[11px] font-bold uppercase tracking-wider text-ink-muted"
                >
                  Kurumsal e-posta
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="username"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ad.soyad@sirketiniz.com"
                    className="w-full rounded-xl border border-line bg-surface-1 py-3 pl-10 pr-3.5 text-[13px] text-ink placeholder:text-ink-faint/60 transition focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block font-mono-tech text-[11px] font-bold uppercase tracking-wider text-ink-muted"
                >
                  Parola
                </label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full rounded-xl border border-line bg-surface-1 py-3 pl-10 pr-11 text-[13px] text-ink placeholder:text-ink-faint/60 transition focus:border-brand focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Parolayı gizle" : "Parolayı göster"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-ink-faint transition hover:text-ink"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3.5 text-[13px] font-bold text-white shadow-lg shadow-brand/25 transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Doğrulanıyor…
                  </>
                ) : (
                  <>
                    Giriş yap
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 flex items-center gap-2 rounded-xl border border-line bg-surface-1 px-3.5 py-3">
              <Lock className="h-3.5 w-3.5 shrink-0 text-positive" />
              <p className="font-mono-tech text-[10px] leading-relaxed text-ink-faint">
                Bağlantı TLS ile şifrelenir ve başarısız denemeler hız sınırıyla korunur.
                Hesabınız yoksa sistem yöneticinizle görüşün.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
