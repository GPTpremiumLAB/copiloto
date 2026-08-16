package com.rotainteligente.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Bundle;
import android.os.IBinder;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Locale;

public class OverlayService extends Service {
    private static final String CHANNEL = "copiloto_viagem";
    private WindowManager windowManager;
    private LinearLayout panel;
    private TextView status;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private WindowManager.LayoutParams params;
    private float touchX, touchY;
    private int startX, startY;

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
        Intent openApp = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(this, 0, openApp, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new Notification.Builder(this, CHANNEL)
            .setContentTitle("Copiloto em viagem")
            .setContentText("Toque na bolha para conversar")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
        startForeground(72, notification);
        setupVoice();
        showOverlay();
    }

    private void createChannel() {
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Copiloto durante a viagem", NotificationManager.IMPORTANCE_LOW);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private void showOverlay() {
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(12, 12, 12, 12);
        panel.setBackgroundColor(Color.rgb(24, 24, 24));
        Button microphone = new Button(this);
        microphone.setText("🎙 Copiloto");
        microphone.setTextColor(Color.rgb(17, 17, 17));
        microphone.setBackgroundColor(Color.rgb(216, 199, 165));
        microphone.setAllCaps(false);
        status = new TextView(this);
        status.setText("Toque para falar");
        status.setTextColor(Color.WHITE);
        status.setPadding(8, 8, 8, 2);
        status.setVisibility(View.GONE);
        Button close = new Button(this);
        close.setText("Fechar"); close.setAllCaps(false);
        close.setVisibility(View.GONE);
        panel.addView(microphone, new LinearLayout.LayoutParams(-1, -2));
        panel.addView(status, new LinearLayout.LayoutParams(-1, -2));
        panel.addView(close, new LinearLayout.LayoutParams(-1, -2));

        params = new WindowManager.LayoutParams(-2, -2, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS, PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.END; params.x = 20; params.y = 220;
        windowManager.addView(panel, params);

        microphone.setOnClickListener(v -> {
            boolean expanded = status.getVisibility() == View.VISIBLE;
            status.setVisibility(expanded ? View.GONE : View.VISIBLE);
            close.setVisibility(expanded ? View.GONE : View.VISIBLE);
            if (!expanded) startListening();
        });
        close.setOnClickListener(v -> stopSelf());
        microphone.setOnTouchListener((v, event) -> {
            if (event.getAction() == MotionEvent.ACTION_DOWN) {
                touchX = event.getRawX(); touchY = event.getRawY(); startX = params.x; startY = params.y;
            } else if (event.getAction() == MotionEvent.ACTION_MOVE) {
                params.x = startX - (int)(event.getRawX() - touchX); params.y = startY + (int)(event.getRawY() - touchY);
                windowManager.updateViewLayout(panel, params);
            }
            return false;
        });
    }

    private void setupVoice() {
        tts = new TextToSpeech(this, result -> { if (result == TextToSpeech.SUCCESS) tts.setLanguage(new Locale("pt", "BR")); });
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            public void onReadyForSpeech(Bundle b) { status.setText("Ouvindo..."); }
            public void onResults(Bundle b) {
                ArrayList<String> values = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String phrase = values == null || values.isEmpty() ? "" : values.get(0);
                String reply = phrase.isEmpty() ? "Não entendi. Toque e tente novamente." : "Eu ouvi: " + phrase;
                status.setText(reply); tts.speak(reply, TextToSpeech.QUEUE_FLUSH, null, "overlay");
            }
            public void onError(int error) { status.setText("Toque para tentar novamente"); }
            public void onBeginningOfSpeech() {} public void onRmsChanged(float rms) {} public void onBufferReceived(byte[] b) {}
            public void onEndOfSpeech() {} public void onPartialResults(Bundle b) {} public void onEvent(int type, Bundle b) {}
        });
    }

    private void startListening() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pt-BR");
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        recognizer.startListening(intent);
    }

    @Override public void onDestroy() {
        if (panel != null && windowManager != null) windowManager.removeView(panel);
        if (recognizer != null) recognizer.destroy();
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
