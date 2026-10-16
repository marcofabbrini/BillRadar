package com.marcofabbrini.billradar;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Scelta delle serie da mostrare nel widget (all'aggiunta, o tenendo premuto il widget → Impostazioni). */
public class WidgetConfigActivity extends Activity {
    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setResult(RESULT_CANCELED);
        Intent in = getIntent();
        if (in != null && in.getExtras() != null) {
            widgetId = in.getExtras().getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        }
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return; }

        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (18 * d);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("Cosa vuoi vedere nel widget?");
        title.setTextSize(18);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        root.addView(title);
        TextView hint = new TextView(this);
        hint.setText("Scegli le serie del grafico. L'indicatore delle nuove bollette (ultimi 7 giorni) è sempre presente.");
        hint.setTextSize(13);
        hint.setPadding(0, (int) (6 * d), 0, (int) (10 * d));
        root.addView(hint);

        final List<String> ids = new ArrayList<>();
        final List<CheckBox> boxes = new ArrayList<>();
        JSONArray series = null;
        try {
            String json = getSharedPreferences(ChartWidgetProvider.PREFS, Context.MODE_PRIVATE).getString("snapshot", null);
            if (json != null) series = new JSONObject(json).optJSONArray("series");
        } catch (Exception ignored) { /* nessun dato */ }

        Set<String> current = ChartWidgetProvider.selection(this, widgetId);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        if (series == null || series.length() == 0) {
            TextView none = new TextView(this);
            none.setText("Apri prima BillRadar e sincronizza le bollette: poi potrai scegliere le serie. Per ora il widget mostrerà tutto.");
            list.addView(none);
        } else {
            for (int i = 0; i < series.length(); i++) {
                JSONObject s = series.optJSONObject(i);
                if (s == null) continue;
                CheckBox cb = new CheckBox(this);
                cb.setText(s.optString("label"));
                cb.setTextSize(16);
                try { cb.setTextColor(Color.parseColor(s.optString("color"))); } catch (Exception ignored) { /* colore predefinito */ }
                cb.setChecked(current == null || current.contains(s.optString("id")));
                list.addView(cb);
                ids.add(s.optString("id"));
                boxes.add(cb);
            }
        }
        ScrollView sv = new ScrollView(this);
        sv.addView(list);
        root.addView(sv, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        Button ok = new Button(this);
        ok.setText("Salva");
        ok.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Set<String> sel = new HashSet<>();
                for (int i = 0; i < boxes.size(); i++) if (boxes.get(i).isChecked()) sel.add(ids.get(i));
                SharedPreferencesHelper.save(WidgetConfigActivity.this, widgetId, boxes.isEmpty() ? null : sel);
                ChartWidgetProvider.update(WidgetConfigActivity.this, AppWidgetManager.getInstance(WidgetConfigActivity.this), widgetId);
                Intent r = new Intent();
                r.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
                setResult(RESULT_OK, r);
                finish();
            }
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.BOTTOM;
        root.addView(ok, lp);
        setContentView(root);
    }

    /** Salvataggio della scelta per singolo widget. */
    static final class SharedPreferencesHelper {
        static void save(Context ctx, int id, Set<String> sel) {
            android.content.SharedPreferences.Editor e = ctx.getSharedPreferences(ChartWidgetProvider.PREFS, Context.MODE_PRIVATE).edit();
            if (sel == null) e.remove("sel_" + id); else e.putStringSet("sel_" + id, sel);
            e.apply();
        }
    }
}
