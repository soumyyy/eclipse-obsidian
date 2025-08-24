"use client";

import { useState, useEffect } from "react";
import { X, Plus, Check } from "lucide-react";

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
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/tasks?user_id=soumya&status=open&limit=200`, { 
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
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/tasks`, {
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
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/tasks/${taskId}/complete?user_id=soumya`, { 
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-black border border-gray-700 rounded-xl w-full max-w-md max-h-[80vh] overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-medium text-white">Tasks</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Add Task */}
        <div className="p-3 border-b border-gray-700">
          <div className="flex gap-2">
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTask();
              }}
              placeholder="Add a new task..."
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white placeholder-gray-400 focus:border-gray-600 text-sm"
            />
            <button
              onClick={addTask}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded transition-colors text-sm border border-gray-700"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Tasks List */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="text-center py-6 text-gray-400">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-500 mx-auto mb-2"></div>
              <p className="text-sm">Loading...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-6 text-gray-400">
              <p className="text-sm">No tasks yet</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-2 p-2 bg-gray-900 border border-gray-800 rounded hover:bg-gray-800 transition-colors"
                >
                  <button
                    onClick={() => completeTask(task.id)}
                    className="mt-0.5 w-4 h-4 rounded border border-gray-600 bg-gray-800 hover:bg-gray-700 hover:border-gray-500 transition-colors flex items-center justify-center"
                  >
                    <Check className="w-2.5 h-2.5 text-white opacity-0 hover:opacity-100" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm">{task.content}</p>
                    {task.due_ts && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Due: {new Date(task.due_ts * 1000).toLocaleString()}
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
          <div className="border-t border-gray-700 p-3">
            {/* <h3 className="text-xs text-gray-400 mb-2 uppercase tracking-wide">Completed</h3> */}
            <div className="space-y-1">
              {completedTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 p-2 bg-gray-900/50 border border-gray-800 rounded text-sm text-gray-400"
                >
                  <button
                    onClick={() => toggleCompletedTask(task.id)}
                    className="w-4 h-4 rounded border border-gray-700 bg-gray-800 hover:bg-gray-700 transition-colors flex items-center justify-center"
                  >
                    <Check className="w-2.5 h-2.5 text-white" />
                  </button>
                  <span className="line-through">{task.content}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
