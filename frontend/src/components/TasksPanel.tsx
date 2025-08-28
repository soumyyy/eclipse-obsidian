"use client";

import { useState, useEffect } from "react";
import { X, Plus, Check } from "lucide-react";
import { getBackendUrl } from "@/utils/config";

interface Task {
  id: number;
  content: string;
  due_ts?: number;
  status: string;
  created_ts: number;
}

interface TasksPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TasksPanel({ isOpen, onClose }: TasksPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (isOpen) {
      loadTasks();
    }
  }, [isOpen]);

  const loadTasks = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${getBackendUrl()}/tasks?user_id=soumya&status=open&limit=200`, { 
        cache: "no-store",
        headers: {
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
        }
      });
      const data = await response.json();
      if (data.ok) setTasks(data.tasks || []);
    } catch (error) {
      console.error("Error loading tasks:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const addTask = async () => {
    if (!newTask.trim()) return;
    try {
      const response = await fetch(`${getBackendUrl()}/tasks`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
        },
        body: JSON.stringify({ user_id: "soumya", content: newTask })
      });
      if (response.ok) {
        setNewTask("");
        loadTasks();
      }
    } catch (error) {
      console.error("Error adding task:", error);
    }
  };

  const completeTask = async (taskId: number) => {
    try {
      const response = await fetch(`${getBackendUrl()}/tasks/${taskId}/complete?user_id=soumya`, { 
        method: "POST",
        headers: {
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
        }
      });
      if (response.ok) {
        const taskToComplete = tasks.find(t => t.id === taskId);
        if (taskToComplete) {
          setCompletedTasks(prev => [...prev, taskToComplete]);
          setTasks(prev => prev.filter(t => t.id !== taskId));
        }
      }
    } catch (error) {
      console.error("Error completing task:", error);
    }
  };

  const toggleCompletedTask = (taskId: number) => {
    setCompletedTasks(prev => prev.filter(t => t.id !== taskId));
  };

  if (!isOpen) return null;

  return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="bg-black/95 backdrop-blur-xl border border-white/20 rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-4 border-b border-white/20">
          <h2 className="text-lg sm:text-xl font-semibold text-white">Tasks</h2>
          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={18} className="sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Add Task Form */}
        <div className="p-3 sm:p-4 border-b border-white/20">
          <div className="flex gap-2">
            <input
              type="text"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
              placeholder="Add a new task..."
              className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/20 text-sm sm:text-base"
            />
            <button
              onClick={addTask}
              disabled={!newTask.trim()}
              className="px-3 py-2 bg-white/20 text-white rounded-lg hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm sm:text-base"
            >
              <Plus size={16} className="sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>

        {/* Tasks List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {isLoading ? (
            <div className="text-center py-8">
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-white/60 text-sm">Loading tasks...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-white/60 text-sm">No tasks yet. Add one above!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-3 p-3 sm:p-4 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
                >
                  <button
                    onClick={() => completeTask(task.id)}
                    className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 border-white/30 hover:border-white/50 transition-colors flex items-center justify-center"
                  >
                    <Check size={12} className="sm:w-4 sm:h-4 text-white/60" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm sm:text-base text-white/90 break-words">{task.content}</p>
                    {task.due_ts && (
                      <p className="text-xs text-white/50 mt-1">
                        Due: {new Date(task.due_ts * 1000).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Completed Tasks */}
        {completedTasks.length > 0 && (
          <div className="border-t border-white/20 p-3 sm:p-4">
            <h3 className="text-sm sm:text-base font-medium text-white/70 mb-3">Completed ({completedTasks.length})</h3>
            <div className="space-y-2">
              {completedTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-3 p-2 sm:p-3 bg-white/5 border border-white/10 rounded-lg opacity-60"
                >
                  <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
                    <Check size={12} className="sm:w-4 sm:h-4 text-green-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-white/60 line-through break-words">{task.content}</p>
                  </div>
                  <button
                    onClick={() => toggleCompletedTask(task.id)}
                    className="text-xs text-white/40 hover:text-white/60 transition-colors"
                  >
                    Undo
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
