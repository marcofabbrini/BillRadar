package com.marcofabbrini.billradar;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Riceve dall'app l'istantanea dei dati e fa ridisegnare i widget. */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("json mancante");
            return;
        }
        getContext().getSharedPreferences(ChartWidgetProvider.PREFS, android.content.Context.MODE_PRIVATE)
                .edit().putString("snapshot", json).apply();
        ChartWidgetProvider.refreshAll(getContext());
        call.resolve();
    }
}
