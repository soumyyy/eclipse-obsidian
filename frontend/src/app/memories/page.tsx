"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Trash2, 
  Edit, 
  Save, 
  X, 
  RefreshCw
} from "lucide-react";

interface Memory {
  id: number;
  content: string;
  type: string;
  created_at: string;
  priority: number;
  confidence: number;
}

interface MaintenanceStats {
  consolidations: number;
  enhancements: number;
  total_memories: number;
}

export default function MemoriesPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isMaintenanceRunning, setIsMaintenanceRunning] = useState(false);
  const [maintenanceStats, setMaintenanceStats] = useState<MaintenanceStats | null>(null);

  useEffect(() => {
    fetchMemories();
  }, []);

  const fetchMemories = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/memories?user_id=soumya`, {
        headers: {
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
        }
      });
      if (response.ok) {
        const data = await response.json();
        setMemories(data.items || []);
      }
    } catch (error) {
      console.error("Error fetching memories:", error);
    }
  };

  const runMemoryMaintenance = async () => {
    setIsMaintenanceRunning(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/admin/memory/maintenance`, { 
        method: "POST",
        headers: {
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
        }
      });
      const data = await response.json();
      if (response.ok && data?.ok) {
        setMaintenanceStats(data.stats);
        setTimeout(() => fetchMemories(), 1000);
      } else {
        throw new Error(data?.error || "Maintenance failed");
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error("Memory maintenance error:", errorMessage);
    } finally {
      setIsMaintenanceRunning(false);
    }
  };

  const deleteMemory = async (memoryId: number) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/memories/${memoryId}`, {
        method: "DELETE",
        headers: {
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
        }
      });
      
      if (response.ok) {
        // Remove the deleted memory from the local state
        setMemories(memories.filter(memory => memory.id !== memoryId));
      } else {
        const data = await response.json();
        throw new Error(data?.error || "Failed to delete memory");
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error("Error deleting memory:", errorMessage);
      alert(`Failed to delete memory: ${errorMessage}`);
    }
  };

  const saveMemory = async (memoryId: number, newContent: string) => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000'}/memories/${memoryId}`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
        },
        body: JSON.stringify({
          user_id: "soumya",
          content: newContent
        })
      });
      
      if (response.ok) {
        // Update the memory in local state
        setMemories(memories.map(memory => 
          memory.id === memoryId 
            ? { ...memory, content: newContent }
            : memory
        ));
        setEditingId(null);
        setEditContent("");
      } else {
        const data = await response.json();
        throw new Error(data?.error || "Failed to update memory");
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error("Error updating memory:", errorMessage);
      alert(`Failed to update memory: ${errorMessage}`);
    }
  };

  const filteredMemories = memories.filter(memory =>
    (memory.content || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (memory.type || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getPriorityColor = (priority: number) => {
    switch (priority) {
      case 1: return "bg-red-500/20 text-red-300 border-red-500/30";
      case 2: return "bg-yellow-500/20 text-yellow-300 border-yellow-500/30";
      case 3: return "bg-gray-800 text-gray-300 border-gray-600";
      default: return "bg-gray-700 text-gray-300 border-gray-600";
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">
              Memory & Sessions
            </h1>
            <p className="text-gray-400 mt-2">Manage your AI assistant&apos;s knowledge and chat sessions</p>
          </div>
          
          {/* Memory Maintenance Button */}
          <div className="flex items-center gap-4">
            <Button
              onClick={runMemoryMaintenance}
              disabled={isMaintenanceRunning}
              className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-2 rounded-lg transition-colors border border-gray-600"
            >
              {isMaintenanceRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  Memory Maintenance
                </>
              )}
            </Button>
            
            {maintenanceStats && (
              <div className="bg-gray-800 rounded-lg p-3 border border-gray-600">
                <div className="text-xs text-gray-300 mb-1">Last Maintenance</div>
                <div className="text-sm">
                  <span className="text-green-400">{maintenanceStats.consolidations}</span> merged,{" "}
                  <span className="text-gray-400">{maintenanceStats.enhancements}</span> enhanced
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Memories Content */}
        <div className="w-full">
          <div className="bg-black border border-black rounded-lg p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium text-white">
                Memories ({filteredMemories.length})
              </h2>
              <div className="relative">
                <Input
                  placeholder="Search memories..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-gray-900 border-gray-700 text-white placeholder-gray-400 focus:border-gray-600 focus:ring-gray-600/20"
                />
              </div>
            </div>
            
            {filteredMemories.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p className="text-lg font-medium">No memories found</p>
                <p className="text-sm">Try adjusting your search or create new memories through chat</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredMemories.map((memory) => (
                  <div
                    key={memory.id}
                    className="bg-black border border-gray-800 rounded p-3 hover:bg-gray-900 transition-all duration-200"
                  >
                    {editingId === memory.id ? (
                      <div className="space-y-3">
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white placeholder-gray-400 focus:border-gray-600 focus:ring-gray-600/20 resize-none"
                          rows={3}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => {
                              saveMemory(memory.id, editContent);
                            }}
                            size="sm"
                            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded transition-colors"
                          >
                            <Save className="w-4 h-4 mr-2" />
                            Save
                          </Button>
                          <Button
                            onClick={() => {
                              setEditingId(null);
                              setEditContent("");
                            }}
                            size="sm"
                            variant="ghost"
                            className="text-gray-400 hover:text-white hover:bg-gray-800 px-3 py-1.5 rounded transition-colors"
                          >
                            <X className="w-4 h-4 mr-2" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge className={getPriorityColor(memory.priority || 0)}>
                              {memory.type || 'unknown'}
                            </Badge>
                          </div>
                          
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              onClick={() => {
                                setEditingId(memory.id);
                                setEditContent(memory.content || '');
                              }}
                              size="sm"
                              variant="ghost"
                              className="text-gray-400 hover:text-white hover:bg-gray-800 p-1 rounded transition-colors"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                        
                        <p className="text-white leading-relaxed">{memory.content || 'No content'}</p>
                        
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-xs text-gray-500">
                            {memory.created_at ? new Date(memory.created_at).toLocaleDateString() : 'Unknown date'}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setEditingId(memory.id);
                                setEditContent(memory.content || '');
                              }}
                              className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                            >
                              <Edit className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Are you sure you want to delete this memory?')) {
                                  deleteMemory(memory.id);
                                }
                              }}
                              className="p-1 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


