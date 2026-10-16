package com.marcofabbrini.billradar;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.Typeface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Disegna il grafico del widget in una bitmap (stesso stile dell'app: linee morbili, niente pallini). */
final class ChartRenderer {
    private ChartRenderer() {}

    private static final int FG = Color.parseColor("#E9FBFF");
    private static final int MUTED = Color.parseColor("#8FB4C6");
    private static final int ACC = Color.parseColor("#35C8FF");

    static Bitmap render(JSONObject snap, Set<String> selected, int w, int h, float d) {
        Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bmp);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);

        // sfondo
        RectF bg = new RectF(0, 0, w, h);
        float rad = 20 * d;
        p.setShader(new LinearGradient(0, 0, 0, h, Color.parseColor("#0B2238"), Color.parseColor("#06121F"), Shader.TileMode.CLAMP));
        c.drawRoundRect(bg, rad, rad, p);
        p.setShader(null);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(1.2f * d);
        p.setColor(Color.argb(110, 53, 200, 255));
        c.drawRoundRect(new RectF(d, d, w - d, h - d), rad, rad, p);
        p.setStyle(Paint.Style.FILL);

        if (snap == null) {
            text(c, p, "Apri BillRadar per caricare i dati", w / 2f, h / 2f, 13 * d, MUTED, Paint.Align.CENTER, false);
            return bmp;
        }

        float wDp = w / d, hDp = h / d;
        float pad = 12 * d;

        // ---- intestazione: titolo + indicatore nuove bollette (ultimi 7 giorni)
        int fresh = 0;
        String freshTxt = "";
        JSONObject fo = snap.optJSONObject("fresh");
        if (fo != null) {
            fresh = fo.optInt("count");
            freshTxt = fo.optString("text");
        }
        text(c, p, "BillRadar", pad, pad + 13 * d, 14 * d, FG, Paint.Align.LEFT, true);

        String badge = fresh > 0 ? fresh + (fresh == 1 ? " nuova" : " nuove") : "nessuna nuova";
        p.setTextSize(11.5f * d);
        p.setTypeface(Typeface.DEFAULT_BOLD);
        float bw = p.measureText(badge) + 22 * d, bh = 22 * d;
        RectF pill = new RectF(w - pad - bw, pad - 1 * d, w - pad, pad - 1 * d + bh);
        p.setColor(fresh > 0 ? Color.argb(255, 53, 200, 255) : Color.argb(60, 143, 180, 198));
        c.drawRoundRect(pill, bh / 2, bh / 2, p);
        text(c, p, badge, pill.centerX(), pill.centerY() + 4.2f * d, 11.5f * d, fresh > 0 ? Color.parseColor("#04202E") : MUTED, Paint.Align.CENTER, true);

        float top = pad + 26 * d;
        if (hDp >= 120 && wDp >= 190) {
            String sub = fresh > 0 ? freshTxt + " · ultimi 7 giorni" : "ultimi 7 giorni";
            text(c, p, ellipsize(p, sub, w - 2 * pad, 10.5f * d), pad, top + 4 * d, 10.5f * d, MUTED, Paint.Align.LEFT, false);
            top += 14 * d;
        }

        // ---- dati
        JSONArray labels = snap.optJSONArray("labels");
        JSONArray all = snap.optJSONArray("series");
        List<JSONObject> series = new ArrayList<>();
        if (all != null) {
            for (int i = 0; i < all.length(); i++) {
                JSONObject s = all.optJSONObject(i);
                if (s != null && (selected == null || selected.contains(s.optString("id")))) series.add(s);
            }
        }
        int n = labels != null ? labels.length() : 12;
        if (n < 2) n = 12;

        // legenda in basso (solo se c'è spazio)
        boolean legend = hDp >= 150 && !series.isEmpty();
        float legendH = legend ? 20 * d : 0;
        float xLab = hDp >= 100 ? 14 * d : 0;
        float left = pad + 30 * d, right = w - pad;
        float cTop = top + 8 * d, cBot = h - pad - legendH - xLab;
        if (cBot - cTop < 20 * d) return bmp;

        double max = 1;
        for (JSONObject s : series) {
            JSONArray v = s.optJSONArray("values");
            for (int i = 0; v != null && i < v.length(); i++) max = Math.max(max, v.optDouble(i));
        }
        max = niceMax(max);

        // griglia + scala €
        for (int i = 0; i <= 4; i++) {
            float y = cBot - (cBot - cTop) * i / 4f;
            p.setColor(Color.argb(i == 0 ? 90 : 45, 120, 190, 220));
            p.setStrokeWidth(1f * d);
            if (i == 0) c.drawLine(left, y, right, y, p);
            else dashed(c, p, left, right, y, d);
            if (hDp >= 100 || i % 2 == 0) text(c, p, fmt(max * i / 4), left - 5 * d, y + 3.5f * d, 9.5f * d, MUTED, Paint.Align.RIGHT, false);
        }
        // mesi
        if (xLab > 0 && labels != null) {
            int step = wDp < 260 ? 3 : wDp < 380 ? 2 : 1;
            for (int m = 0; m < n; m += step) {
                float x = left + (right - left) * m / (n - 1f);
                text(c, p, labels.optString(m), x, h - pad - legendH - 2 * d, 9.5f * d, MUTED, Paint.Align.CENTER, false);
            }
        }

        // linee
        for (JSONObject s : series) {
            int color;
            try { color = Color.parseColor(s.optString("color", "#35C8FF")); } catch (Exception e) { color = ACC; }
            JSONArray v = s.optJSONArray("values");
            List<float[]> pts = new ArrayList<>();
            for (int m = 0; v != null && m < v.length() && m < n; m++) {
                double val = v.optDouble(m);
                if (val > 0) pts.add(new float[]{left + (right - left) * m / (n - 1f), (float) (cBot - (cBot - cTop) * (val / max))});
            }
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeCap(Paint.Cap.ROUND);
            p.setStrokeJoin(Paint.Join.ROUND);
            p.setColor(color);
            if (pts.size() >= 2) {
                p.setStrokeWidth(2.4f * d);
                p.setShadowLayer(4 * d, 0, 0, color);
                c.drawPath(smooth(pts), p);
                p.clearShadowLayer();
            } else if (pts.size() == 1) {
                p.setStyle(Paint.Style.FILL);
                c.drawCircle(pts.get(0)[0], pts.get(0)[1], 3.2f * d, p);   // serie con un solo mese
            }
            p.setStyle(Paint.Style.FILL);
        }
        if (series.isEmpty()) text(c, p, "Nessuna serie selezionata", (left + right) / 2, (cTop + cBot) / 2, 12 * d, MUTED, Paint.Align.CENTER, false);

        // legenda
        if (legend) {
            float x = pad, y = h - pad - 5 * d;
            for (JSONObject s : series) {
                String lab = s.optString("label");
                p.setTextSize(10.5f * d);
                p.setTypeface(Typeface.DEFAULT);
                float tw = p.measureText(lab);
                if (x + 12 * d + tw > w - pad) break;
                int color;
                try { color = Color.parseColor(s.optString("color", "#35C8FF")); } catch (Exception e) { color = ACC; }
                p.setColor(color);
                c.drawCircle(x + 4 * d, y - 3.5f * d, 3.6f * d, p);
                text(c, p, lab, x + 11 * d, y, 10.5f * d, FG, Paint.Align.LEFT, false);
                x += 11 * d + tw + 12 * d;
            }
        }
        return bmp;
    }

    // ---- utilità ----
    private static void text(Canvas c, Paint p, String t, float x, float y, float size, int color, Paint.Align a, boolean bold) {
        p.setStyle(Paint.Style.FILL);
        p.setColor(color);
        p.setTextSize(size);
        p.setTextAlign(a);
        p.setTypeface(bold ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        c.drawText(t, x, y, p);
    }

    private static String ellipsize(Paint p, String t, float maxW, float size) {
        p.setTextSize(size);
        if (p.measureText(t) <= maxW) return t;
        while (t.length() > 1 && p.measureText(t + "…") > maxW) t = t.substring(0, t.length() - 1);
        return t + "…";
    }

    private static void dashed(Canvas c, Paint p, float x1, float x2, float y, float d) {
        for (float x = x1; x < x2; x += 7 * d) c.drawLine(x, y, Math.min(x + 3 * d, x2), y, p);
    }

    private static String fmt(double v) {
        return String.format(Locale.ITALY, v >= 1000 ? "%.0f€" : "%.0f€", v);
    }

    private static double niceMax(double v) {
        double e = Math.pow(10, Math.floor(Math.log10(v))), f = v / e;
        return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
    }

    /** Curva monotona (Fritsch–Carlson): morbida ma senza sbalzi oltre i valori reali. */
    private static Path smooth(List<float[]> pts) {
        int n = pts.size();
        float[] dx = new float[n - 1], sl = new float[n - 1], t = new float[n];
        for (int i = 0; i < n - 1; i++) {
            dx[i] = pts.get(i + 1)[0] - pts.get(i)[0];
            sl[i] = (pts.get(i + 1)[1] - pts.get(i)[1]) / dx[i];
        }
        t[0] = sl[0];
        t[n - 1] = sl[n - 2];
        for (int i = 1; i < n - 1; i++) t[i] = sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2;
        for (int i = 0; i < n - 1; i++) {
            if (sl[i] == 0) { t[i] = 0; t[i + 1] = 0; continue; }
            float a = t[i] / sl[i], b = t[i + 1] / sl[i], s = a * a + b * b;
            if (s > 9) { float k = 3 / (float) Math.sqrt(s); t[i] = k * a * sl[i]; t[i + 1] = k * b * sl[i]; }
        }
        Path path = new Path();
        path.moveTo(pts.get(0)[0], pts.get(0)[1]);
        for (int i = 0; i < n - 1; i++) {
            float h = dx[i] / 3;
            path.cubicTo(pts.get(i)[0] + h, pts.get(i)[1] + t[i] * h,
                    pts.get(i + 1)[0] - h, pts.get(i + 1)[1] - t[i + 1] * h,
                    pts.get(i + 1)[0], pts.get(i + 1)[1]);
        }
        return path;
    }
}
