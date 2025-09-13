import { useState, useRef, useCallback } from "react";

export function useRecording() {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribingDots, setTranscribingDots] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const transcribeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };
      
      mr.onstop = async () => {
        try {
          // Clear any existing transcribing dots interval
          if (transcribeIntervalRef.current) {
            clearInterval(transcribeIntervalRef.current); 
          }
        } catch {}
        transcribeIntervalRef.current = setInterval(() => {
          setTranscribingDots((d: string) => (d.length >= 3 ? "" : d + "."));
        }, 350);
        try {
          const blob = new Blob(recordedChunksRef.current, { type: mr.mimeType || 'audio/webm' });
          const form = new FormData();
          form.append('audio', blob, 'audio.webm');
          
          const response = await fetch(`/api/transcribe`, {
            method: 'POST',
            headers: {
              'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
            },
            body: form
          });
          
          if (response.ok) {
            const data = await response.json();
            const transcript = data.transcript || '';
            if (transcript.trim()) {
              // This would need to be passed as a callback
              console.log('Transcript:', transcript);
            }
          }
        } catch (err) {
          console.error('Transcription failed:', err);
        } finally {
          setTranscribing(false);
          try {
            if (transcribeIntervalRef.current) {
              clearInterval(transcribeIntervalRef.current); 
            }
          } catch {}
          setTranscribingDots("");
        }
      };
      mr.start();
      setRecording(true);
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
      setTranscribing(true);
      
      // Stop all tracks to release microphone
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    }
  }, [recording]);

  return {
    recording,
    setRecording,
    transcribing,
    setTranscribing,
    transcribingDots,
    setTranscribingDots,
    startRecording,
    stopRecording
  };
}