package com.rotainteligente.app;

import android.Manifest;
import android.app.Activity;
import android.app.Presentation;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.display.DisplayManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.Locale;

public class MainActivity extends Activity implements LocationListener {
    private static final int PERMISSIONS = 20;
    private final int black = Color.rgb(17,17,17), beige = Color.rgb(216,199,165), white = Color.rgb(245,245,242), gray = Color.rgb(38,38,38);
    private TextView speed, assistant, listening;
    private EditText destination;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private LocationManager locationManager;
    private Location lastLocation;
    private Presentation externalPresentation;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(buildPanel(false));
        requestPermissionsIfNeeded();
        setupVoice();
        showOnExternalDisplay();
    }

    private View buildPanel(boolean external) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL); root.setPadding(28,28,28,28); root.setBackgroundColor(black); root.setGravity(Gravity.CENTER_HORIZONTAL);
        TextView brand = label("ROTA INTELIGENTE", 25, beige); brand.setGravity(Gravity.CENTER); root.addView(brand, matchWrap());
        TextView subtitle = label(external ? "Painel da viagem" : "Seu copiloto de voz", 14, white); subtitle.setGravity(Gravity.CENTER); root.addView(subtitle, matchWrap());
        speed = label("0 km/h", external ? 64 : 48, white); speed.setGravity(Gravity.CENTER); speed.setPadding(0,34,0,24); root.addView(speed, matchWrap());
        assistant = label("Diga para onde deseja ir ou toque no microfone.", 18, white); assistant.setBackgroundColor(gray); assistant.setPadding(22,22,22,22); root.addView(assistant, matchWrap());
        listening = label("Microfone pronto", 14, beige); listening.setPadding(0,14,0,8); root.addView(listening, matchWrap());
        if (!external) {
            destination = new EditText(this); destination.setHint("Destino em poucas palavras"); destination.setTextColor(white); destination.setHintTextColor(Color.LTGRAY); destination.setBackgroundColor(gray); destination.setPadding(18,16,18,16); root.addView(destination, matchWrap());
            Button mic = button("🎙  Falar com o copiloto"); mic.setOnClickListener(v -> startListening()); root.addView(mic, matchWrap());
            Button maps = button("Abrir no Google Maps"); maps.setOnClickListener(v -> openMaps(false)); root.addView(maps, matchWrap());
            Button waze = button("Abrir no Waze"); waze.setOnClickListener(v -> openMaps(true)); root.addView(waze, matchWrap());
        }
        return root;
    }

    private TextView label(String text, int size, int color) { TextView v = new TextView(this); v.setText(text); v.setTextSize(size); v.setTextColor(color); v.setFontFeatureSettings("kern"); return v; }
    private Button button(String text) { Button b = new Button(this); b.setText(text); b.setTextSize(17); b.setTextColor(black); b.setBackgroundColor(beige); b.setAllCaps(false); LinearLayout.LayoutParams p=matchWrap(); p.setMargins(0,12,0,0); b.setLayoutParams(p); return b; }
    private LinearLayout.LayoutParams matchWrap() { return new LinearLayout.LayoutParams(-1,-2); }

    private void requestPermissionsIfNeeded() {
        ArrayList<String> needed = new ArrayList<>();
        for (String p : new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.RECORD_AUDIO}) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) needed.add(p);
        if (!needed.isEmpty()) requestPermissions(needed.toArray(new String[0]), PERMISSIONS); else startLocation();
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) { super.onRequestPermissionsResult(request, permissions, results); if (request == PERMISSIONS) startLocation(); }
    private void startLocation() { if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) { locationManager=(LocationManager)getSystemService(LOCATION_SERVICE); locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 5, this); } }
    @Override public void onLocationChanged(Location location) { lastLocation=location; int kmh=Math.max(0,Math.round(location.hasSpeed()?location.getSpeed()*3.6f:0)); speed.setText(kmh+" km/h"); }

    private void setupVoice() {
        tts = new TextToSpeech(this, status -> { if(status==TextToSpeech.SUCCESS) tts.setLanguage(new Locale("pt","BR")); });
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            public void onReadyForSpeech(Bundle b){ listening.setText("Ouvindo..."); }
            public void onResults(Bundle b){ ArrayList<String> r=b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION); if(r!=null&&!r.isEmpty()) handleSpeech(r.get(0)); listening.setText("Microfone pronto"); }
            public void onError(int e){ listening.setText("Toque para tentar novamente"); }
            public void onBeginningOfSpeech(){} public void onRmsChanged(float v){} public void onBufferReceived(byte[] b){} public void onEndOfSpeech(){} public void onPartialResults(Bundle b){} public void onEvent(int t,Bundle b){}
        });
    }

    private void startListening() { Intent i=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH); i.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"pt-BR"); i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM); i.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,true); recognizer.startListening(i); }
    private void handleSpeech(String phrase) {
        String lower=phrase.toLowerCase(Locale.ROOT); assistant.setText("Você: "+phrase);
        String target=phrase.replaceFirst("(?i).*(me leve|ir|rota|navegar|destino|até|para)\\s+(para\\s+)?","").trim();
        if(!target.equals(phrase)&&target.length()>2){ destination.setText(target); reply("Encontrei o destino "+target+". Escolha Maps ou Waze para iniciar."); }
        else if(lower.contains("velocidade")){ reply("Sua velocidade indicada é "+speed.getText()+"."); }
        else { reply("Eu ouvi: "+phrase+". A conversa inteligente será conectada na próxima etapa."); }
    }
    private void reply(String text){ assistant.setText(text); tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,"assistant"); }

    private void openMaps(boolean waze) {
        String target=destination.getText().toString().trim(); if(target.isEmpty()){ Toast.makeText(this,"Informe ou fale um destino",Toast.LENGTH_SHORT).show(); return; }
        Uri uri=waze?Uri.parse("https://waze.com/ul?q="+Uri.encode(target)+"&navigate=yes"):Uri.parse("google.navigation:q="+Uri.encode(target));
        Intent i=new Intent(Intent.ACTION_VIEW,uri); if(waze)i.setPackage("com.waze"); else i.setPackage("com.google.android.apps.maps");
        try{startActivity(i);}catch(Exception e){startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://www.google.com/maps/dir/?api=1&destination="+Uri.encode(target))));}
    }

    private void showOnExternalDisplay() {
        Display[] displays=((DisplayManager)getSystemService(DISPLAY_SERVICE)).getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION);
        if(displays.length>0){ externalPresentation=new Presentation(this,displays[0]); externalPresentation.setContentView(buildPanel(true)); externalPresentation.show(); }
    }
    @Override protected void onDestroy(){ if(recognizer!=null)recognizer.destroy(); if(tts!=null)tts.shutdown(); if(locationManager!=null)locationManager.removeUpdates(this); if(externalPresentation!=null)externalPresentation.dismiss(); super.onDestroy(); }
}
