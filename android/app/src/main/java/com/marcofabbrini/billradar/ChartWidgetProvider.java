package com.marcofabbrini.billradar;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Widget con il grafico degli andamenti; si adatta alla dimensione scelta dall'utente. */
public class ChartWidgetProvider extends AppWidgetProvider {
    static final String PREFS = "billradar_widget";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) update(ctx, mgr, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle newOptions) {
        update(ctx, mgr, id);   // ridimensionato: ridisegna alla nuova misura
    }

    @Override
    public void onDeleted(Context ctx, int[] ids) {
        SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        for (int id : ids) e.remove("sel_" + id);
        e.apply();
    }

    static void refreshAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, ChartWidgetProvider.class));
        for (int id : ids) update(ctx, mgr, id);
    }

    static Set<String> selection(Context ctx, int id) {
        Set<String> s = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getStringSet("sel_" + id, null);
        return s == null ? null : new HashSet<>(s);   // null = tutte le serie
    }

    static void update(Context ctx, AppWidgetManager mgr, int id) {
        try {
            DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
            float d = dm.density;
            Bundle o = mgr.getAppWidgetOptions(id);
            boolean land = ctx.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE;
            int wDp = o.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH : AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250);
            int hDp = o.getInt(land ? AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT : AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 160);
            if (wDp <= 0) wDp = 250;
            if (hDp <= 0) hDp = 160;
            int w = Math.round(wDp * d), h = Math.round(hDp * d);
            // limite di memoria delle RemoteViews: bitmap contenuta (~1,2 milioni di pixel)
            long maxPx = 1_200_000L;
            if ((long) w * h > maxPx) {
                double k = Math.sqrt((double) maxPx / ((long) w * h));
                w = (int) (w * k);
                h = (int) (h * k);
                d = d * (float) k;
            }

            JSONObject snap = null;
            String json = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("snapshot", null);
            if (json != null) {
                try { snap = new JSONObject(json); } catch (Exception ignored) { /* istantanea non valida */ }
            }
            Bitmap bmp = ChartRenderer.render(snap, selection(ctx, id), w, h, d);

            RemoteViews rv = new RemoteViews(ctx.getPackageName(), R.layout.widget_chart);
            rv.setImageViewBitmap(R.id.chart, bmp);
            Intent open = new Intent(ctx, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            rv.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            mgr.updateAppWidget(id, rv);
        } catch (Throwable t) {
            android.util.Log.e("BillRadarWidget", "aggiornamento widget fallito", t);
        }
    }
}
