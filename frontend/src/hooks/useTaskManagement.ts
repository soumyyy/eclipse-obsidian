import { useState, useCallback } from "react";
import { apiTasksExtract, apiTaskCreate } from "@/lib/api";
import { TaskCandidate } from "@/types/chat";

export function useTaskManagement() {
  const [taskCandByIndex, setTaskCandByIndex] = useState<Record<number, TaskCandidate[]>>({});

  const handleTaskAdd = useCallback((title: string) => {
    return async () => {
      try {
        await apiTaskCreate(title);
        console.log("Task created:", title);
      } catch (error) {
        console.error("Failed to create task:", error);
      }
    };
  }, []);

  const handleTaskDismiss = useCallback((messageIndex: number) => {
    return (candidateIndex: number) => {
      setTaskCandByIndex(prev => {
        const updated = { ...prev };
        if (updated[messageIndex]) {
          updated[messageIndex] = updated[messageIndex].filter((_, idx) => idx !== candidateIndex);
        }
        return updated;
      });
    };
  }, []);

  const extractTaskCandidates = useCallback(async (userMessage: string, userIndex: number) => {
    console.log("DEBUG: extractTaskCandidates called for message:", userMessage.substring(0, 30) + "...", "at index:", userIndex);
    try {
      const data = await apiTasksExtract(userMessage);
      const cands = (data.candidates || []).map((c: { title: string; due_ts?: number; confidence?: number }) => ({
        title: c.title,
        due_ts: c.due_ts,
        confidence: c.confidence
      }));
      console.log("DEBUG: Found", cands.length, "task candidates");
      if (cands.length) {
        setTaskCandByIndex((prev: Record<number, TaskCandidate[]>) => ({ ...prev, [userIndex]: cands }));
      }
    } catch (error) {
      console.error("Failed to extract task candidates:", error);
    }
  }, []);

  return {
    taskCandByIndex,
    setTaskCandByIndex,
    handleTaskAdd,
    handleTaskDismiss,
    extractTaskCandidates
  };
}
