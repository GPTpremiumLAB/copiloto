package com.rotainteligente.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.WindowManager;
import android.widget.Button;

import java.util.ArrayList;
import java.util.Locale;

public class OverlayService extends Service {
    private static final String CHANNEL = "copiloto_viagem";
    private static final long RESPONSE_DELAY_MS = 1200;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WindowManager windowManager;
    private WindowManager.LayoutParams params;
    private Button bubble;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private boolean alwaysListening = true;
    private boolean listening;
    private boolean speaking;
    private String pendingDestination;
    private String pendingNearbySearch;
    private boolean awaitingCategory;
    private float touchX, touchY;
    private int startX, startY;

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
        Intent openApp = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, openApp, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, CHANNEL)
            .setContentTitle("Copiloto ouvindo")
            .setContentText("Toque para pausar; segure para encerrar")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pending).setOngoing(true).build();
        startForeground(72, notification);
        setupVoice();
        showBubble();
    }

    private void createChannel() {
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Copiloto durante a viagem", NotificationManager.IMPORTANCE_LOW);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private void showBubble() {
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        bubble = new Button(this);
        bubble.setText("🎙"); bubble.setTextSize(27); bubble.setGravity(Gravity.CENTER); bubble.setPadding(0, 0, 0, 0);
        bubble.setContentDescription("Copiloto com escuta contínua ligada"); bubble.setElevation(dp(10));
        paintBubble(true);
        params = new WindowManager.LayoutParams(dp(68), dp(68), WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.END; params.x = dp(16); params.y = dp(210);
        windowManager.addView(bubble, params);

        bubble.setOnClickListener(view -> {
            alwaysListening = !alwaysListening;
            paintBubble(alwaysListening);
            bubble.setContentDescription(alwaysListening ? "Copiloto com escuta contínua ligada" : "Copiloto pausado");
            if (alwaysListening) scheduleListening(250); else { recognizer.cancel(); listening = false; }
        });
        bubble.setOnLongClickListener(view -> { stopSelf(); return true; });
        bubble.setOnTouchListener((view, event) -> {
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                touchX = event.getRawX(); touchY = event.getRawY(); startX = params.x; startY = params.y;
            } else if (event.getAction() == MotionEvent.ACTION_MOVE) {
                params.x = startX - (int)(event.getRawX() - touchX); params.y = startY + (int)(event.getRawY() - touchY);
                windowManager.updateViewLayout(bubble, params);
            }
            return false;
        });
        scheduleListening(700);
    }

    private void paintBubble(boolean active) {
        GradientDrawable background = new GradientDrawable();
        background.setShape(GradientDrawable.OVAL);
        background.setColor(active ? Color.rgb(17, 17, 17) : Color.rgb(92, 92, 92));
        background.setStroke(dp(4), active ? Color.rgb(216, 199, 165) : Color.LTGRAY);
        bubble.setTextColor(Color.WHITE); bubble.setBackground(background);
    }

    private void setupVoice() {
        tts = new TextToSpeech(this, result -> {
            if (result == TextToSpeech.SUCCESS) {
                tts.setLanguage(new Locale("pt", "BR"));
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    public void onStart(String id) { speaking = true; }
                    public void onDone(String id) { speaking = false; scheduleListening(400); }
                    public void onError(String id) { speaking = false; scheduleListening(600); }
                });
            }
        });
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            public void onReadyForSpeech(Bundle b) { listening = true; }
            public void onResults(Bundle b) {
                listening = false;
                ArrayList<String> values = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String phrase = values == null || values.isEmpty() ? "" : values.get(0);
                handler.postDelayed(() -> handleSpeech(phrase), RESPONSE_DELAY_MS);
            }
            public void onError(int error) { listening = false; scheduleListening(900); }
            public void onBeginningOfSpeech() {} public void onRmsChanged(float rms) {} public void onBufferReceived(byte[] bytes) {}
            public void onEndOfSpeech() {} public void onPartialResults(Bundle b) {} public void onEvent(int type, Bundle b) {}
        });
    }

    private void handleSpeech(String phrase) {
        String lower = phrase.toLowerCase(Locale.ROOT).trim();
        if (lower.isEmpty()) { scheduleListening(300); return; }
        boolean wakeWord = lower.contains("copiloto");
        if (lower.equals("cancelar") || lower.contains("cancela a rota")) {
            pendingDestination = null; pendingNearbySearch = null; awaitingCategory = false; reply("Pedido cancelado."); return;
        }
        boolean confirmed = lower.equals("confirmar") || lower.equals("confirma") || lower.contains("pode ir") || lower.contains("pode abrir");
        if (confirmed && pendingDestination != null) {
            String destination = pendingDestination; pendingDestination = null; pendingNearbySearch = null;
            reply("Abrindo a nova rota para " + destination + "."); openGoogleMaps(destination); return;
        }
        if (confirmed && pendingNearbySearch != null) {
            String query = pendingNearbySearch; pendingNearbySearch = null; pendingDestination = null;
            reply("Vou mostrar as opções próximas no mapa."); openNearbySearch(query); return;
        }
        if (!wakeWord && !awaitingCategory) { scheduleListening(250); return; }
        String command = wakeWord ? phrase.replaceFirst("(?i).*?copiloto[,:]?\\s*", "").trim() : phrase.trim();
        String normalized = command.toLowerCase(Locale.ROOT);
        awaitingCategory = false;
        if (normalized.contains("onde comer") || normalized.contains("restaurante") || normalized.contains("comida") || normalized.contains("estou com fome") || normalized.contains("tô com fome")) {
            suggestNearby("restaurantes perto de mim", "Posso procurar restaurantes próximos. Diga confirmar ou cancelar."); return;
        }
        if (normalized.contains("shopping") || normalized.contains("loja") || normalized.contains("compras")) {
            suggestNearby("shopping centers perto de mim", "Posso mostrar os shoppings mais próximos. Diga confirmar ou cancelar."); return;
        }
        if (normalized.contains("abastecer") || normalized.contains("combustível") || normalized.contains("gasolina") || normalized.contains("posto")) {
            suggestNearby("postos de combustível perto de mim", "Posso procurar postos de combustível próximos. Diga confirmar ou cancelar."); return;
        }
        if (normalized.contains("hospital") || normalized.contains("pronto atendimento") || normalized.contains("emergência")) {
            suggestNearby("hospitais perto de mim", "Posso mostrar hospitais próximos. Em uma emergência real, ligue para o serviço de emergência. Diga confirmar ou cancelar."); return;
        }
        if (normalized.contains("banheiro") || normalized.contains("parada")) {
            suggestNearby("postos de parada perto de mim", "Posso procurar um local de parada próximo. Diga confirmar ou cancelar."); return;
        }
        if (normalized.contains("o que tem perto") || normalized.contains("lugar para visitar") || normalized.contains("passear")) {
            reply("Posso procurar restaurantes, shoppings, combustível ou lugares para visitar. Diga Copiloto e a categoria desejada."); return;
        }
        String destination = extractDestination(command);
        if (destination != null) {
            pendingDestination = destination; pendingNearbySearch = null;
            reply("Entendi: nova rota para " + destination + ". Diga confirmar ou cancelar."); return;
        }
        awaitingCategory = true;
        reply("Posso mudar sua rota e procurar comida, shopping, combustível ou uma parada. O que você precisa?");
    }

    private void suggestNearby(String query, String prompt) {
        pendingNearbySearch = query; pendingDestination = null; reply(prompt);
    }

    private String extractDestination(String phrase) {
        String destination = phrase.replaceFirst("(?i)^.*?(?:nova rota|mudar rota|trocar rota|me leve|navegar|ir|rota)\\s+(?:para|até|pro|pra)\\s+", "").trim();
        return destination.equals(phrase.trim()) || destination.length() < 3 ? null : destination;
    }

    private void openGoogleMaps(String destination) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(destination)));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); intent.setPackage("com.google.android.apps.maps");
        try { startActivity(intent); }
        catch (Exception error) {
            Intent fallback = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/dir/?api=1&destination=" + Uri.encode(destination)));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(fallback);
        }
    }

    private void openNearbySearch(String query) {
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(query)));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); intent.setPackage("com.google.android.apps.maps");
        try { startActivity(intent); }
        catch (Exception error) {
            Intent fallback = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=" + Uri.encode(query)));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(fallback);
        }
    }

    private void reply(String text) {
        recognizer.cancel(); listening = false; speaking = true;
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "copiloto");
    }

    private void startListening() {
        if (!alwaysListening || listening || speaking) return;
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        try { recognizer.startListening(intent); } catch (RuntimeException error) { scheduleListening(1000); }
    }

    private void scheduleListening(long delayMs) { if (alwaysListening) handler.postDelayed(this::startListening, delayMs); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (bubble != null && windowManager != null) windowManager.removeView(bubble);
        if (recognizer != null) recognizer.destroy();
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
