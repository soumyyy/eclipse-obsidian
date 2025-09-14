import React, { useState, useRef, useCallback } from "react";
import { flushSync } from "react-dom";
import { apiChatStream, apiSessionUpdateTitle } from "@/lib/api";
import { getBackendUrl } from "@/utils/config";
import { ChatMessage } from "@/types/chat";

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const receivedFirstDeltaRef = useRef(false);

  const streamingRef = useRef(false);
  const typewriterRef = useRef<{ timer: ReturnType<typeof setInterval> | null; buffer: string }>({
    timer: null,
    buffer: ""
  });

  // Simplified typewriter effect
  const updateTypewriter = useCallback(() => {
    if (typewriterRef.current.buffer.length > 0) {
      const nextNewline = typewriterRef.current.buffer.indexOf('\n');
      const nextSpace = typewriterRef.current.buffer.indexOf(' ');

      const chunk = nextNewline !== -1
        ? typewriterRef.current.buffer.slice(0, nextNewline + 1)
        : nextSpace !== -1
          ? typewriterRef.current.buffer.slice(0, nextSpace + 1)
          : typewriterRef.current.buffer;

      typewriterRef.current.buffer = typewriterRef.current.buffer.slice(chunk.length);

      setMessages(prev => prev.map((msg, idx) => {
        if (idx === prev.length - 1 && msg.role === 'assistant') {
          console.log("DEBUG: Typewriter updating assistant message content");
          return { ...msg, content: (msg.content || "") + chunk };
        }
        return msg;
      }));
    } else if (!streamingRef.current) {
      // Only update if streaming has actually ended (not just buffer empty)
      if (typewriterRef.current.timer) {
        clearInterval(typewriterRef.current.timer);
        typewriterRef.current.timer = null;
      }
      // Don't update messages here - let the finally block handle final formatting
    }
  }, []);

  const startTypewriter = useCallback(() => {
    if (typewriterRef.current.timer) return;
    typewriterRef.current.timer = setInterval(updateTypewriter, 15);
  }, [updateTypewriter]);

  const updateSessionTitle = useCallback(async (message: string, activeSession: string, onTitleUpdated?: () => void) => {
    try {
      // Clean and prepare the title
      const cleanMessage = message.trim();
      const title = cleanMessage.slice(0, 50).trim();


      // Don't update if title would be empty
      if (!title) {
        return;
      }

      const result = await apiSessionUpdateTitle(activeSession, title, "soumya");

      // Trigger sidebar refresh if update was successful
      if (result.ok) {
        onTitleUpdated?.();
      }
    } catch (error) {
      console.error("Error updating session title:", error);
    }
  }, []);

  const sendMessage = async (
    userMessage: string,
    activeSession: string,
    extractTaskCandidates: (message: string, index: number) => void,
    smoothScrollToBottom: (duration?: number) => void,
    listRef: React.RefObject<HTMLDivElement>
  ) => {
    if (!userMessage.trim()) return;

    // Prevent multiple simultaneous calls
    if (loading) {
      console.warn("DEBUG: useChat sendMessage called while already loading, ignoring");
      return;
    }


    // reset streaming state
    receivedFirstDeltaRef.current = false;

    // Create user message object
    const userMessageObj: ChatMessage = {
      role: "user",
      content: userMessage,
      sources: [],
      formatted: true
    };

    // Clear input and add user message only
    setInput("");
    flushSync(() => {
      setMessages(prev => [...prev, userMessageObj]);
    });
    smoothScrollToBottom(600);

    // Extract task candidates for the user message
    try {
      await extractTaskCandidates(userMessage, messages.length - 1); // Use user message index
    } catch (error) {
      console.error("Error extracting task candidates:", error);
    }

    // Update session title for first message
    // Check if this is the first user message in the session (no previous user messages)
    // Note: messages array now includes the user message we just added, so check all but the last message
    const previousMessages = messages.slice(0, -1); // Exclude the user message we just added
    const hasPreviousUserMessages = previousMessages.some(msg => msg.role === 'user');
    if (!hasPreviousUserMessages) {
      updateSessionTitle(userMessage, activeSession, () => {
        // Add small delay to ensure backend has processed the title update
        setTimeout(() => {
          const event = new CustomEvent('refreshSidebar');
          window.dispatchEvent(event);
        }, 500);
      });
    }

    // Upload files first if any
    if (pendingFiles.length > 0) {
      try {
        const formData = new FormData();
        pendingFiles.forEach(file => formData.append('files', file));
        formData.append('session_id', activeSession);

        const uploadResponse = await fetch(`${getBackendUrl()}/api/upload`, {
          method: 'POST',
          headers: {
            'X-API-Key': process.env.NEXT_PUBLIC_BACKEND_TOKEN || ''
          },
          body: formData
        });

        if (uploadResponse.ok) {
          // Show files as a separate message
          const filesMessage: ChatMessage = {
            role: "user",
            content: `📎 Attached ${pendingFiles.length} file(s): ${pendingFiles.map(f => f.name).join(', ')}`,
            sources: [],
            formatted: true
          };
          setMessages(prev => [...prev, filesMessage]);
        }

        setPendingFiles([]);
      } catch (error) {
        console.error("Error uploading files:", error);
      }
    }

    // Small delay to let the sliding animation complete before starting streaming
    setTimeout(() => {
      setLoading(true);
      streamingRef.current = true;
    }, 200);
    // Clear typewriter state
    if (typewriterRef.current.timer) {
      clearInterval(typewriterRef.current.timer);
      typewriterRef.current.timer = null;
    }
    typewriterRef.current.buffer = "";

    try {
      const response = await apiChatStream({ user_id: "soumya", message: userMessage, session_id: activeSession });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      // If user was near bottom, follow the placeholder
      const el = listRef.current;
      const wasNearBottom = !!el && (el.scrollHeight - el.scrollTop - el.clientHeight < 120);
      if (wasNearBottom) requestAnimationFrame(() => smoothScrollToBottom(300));

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedContent = ""; // used for fallback error and debugging
      let finalBuffer = ""; // accumulate full final for safety
      // SSE event assembly: accumulate data lines per event until blank separator
      let currentEvent: string | null = null;
      let eventDataLines: string[] = [];
      let streamFinished = false;

      try {
        let totalDataReceived = 0;
        let rawTextBuffer = ""; // For handling non-SSE responses
        let hasProcessedEvents = false;
        let chunksProcessed = 0;

        console.log("DEBUG: Starting stream processing...");

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log("DEBUG: Stream reader done, total data received:", totalDataReceived, "bytes, chunks processed:", chunksProcessed, "hasProcessedEvents:", hasProcessedEvents);

            // If we didn't process any SSE events but have raw text, create assistant message
            if (!hasProcessedEvents && rawTextBuffer.trim()) {
              console.log("DEBUG: No SSE events processed, creating assistant message from raw text, content length:", rawTextBuffer.trim().length);
              setMessages(prev => [...prev, {
                role: 'assistant' as const,
                content: rawTextBuffer.trim(),
                sources: [],
                formatted: true
              }]);
            } else if (!hasProcessedEvents) {
              console.log("DEBUG: No data received from backend, creating error message");
              setMessages(prev => [...prev, {
                role: 'assistant' as const,
                content: "I apologize, but I'm unable to generate a response at the moment. Please try again.",
                sources: [],
                formatted: true
              }]);
            }
            break;
          }

          chunksProcessed++;
          const chunkSize = value.length;
          totalDataReceived += chunkSize;

          console.log(`DEBUG: Processing chunk ${chunksProcessed}, size: ${chunkSize} bytes`);

          buffer += decoder.decode(value, { stream: true });

          console.log(`DEBUG: Buffer after chunk ${chunksProcessed}:`, buffer.length > 0 ? `"${buffer.substring(0, 100)}${buffer.length > 100 ? '...' : ''}"` : 'empty');

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          console.log(`DEBUG: Lines in chunk ${chunksProcessed}:`, lines.length);

          for (const line of lines) {
            // Check if this is an SSE event or raw text
            if (line.startsWith('event:') || line.startsWith('data:')) {
              hasProcessedEvents = true; // We have SSE events
            } else if (line.includes('[DONE]')) {
              // Stream completion for raw text responses
              if (receivedFirstDeltaRef.current) {
                setMessages(prev => prev.map((msg, idx) => {
                  if (idx === prev.length - 1 && msg.role === 'assistant') {
                    return { ...msg, content: rawTextBuffer.trim(), formatted: true };
                  }
                  return msg;
                }));
              }
              streamFinished = true;
              break;
            } else if (line.trim() && !line.startsWith('event:') && !line.startsWith('data:')) {
              // This appears to be raw text content
              rawTextBuffer += line + '\n';

              // If this is the first raw text content, create assistant message
              if (!receivedFirstDeltaRef.current) {
                receivedFirstDeltaRef.current = true;
                hasProcessedEvents = true; // Mark that we've started processing
                setMessages(prev => {
                  const lastMsg = prev[prev.length - 1];
                  // Only create new assistant message if the last message isn't already an assistant
                  if (lastMsg && lastMsg.role === 'assistant') {
                    // Update existing assistant message
                    return prev.map((msg, idx) =>
                      idx === prev.length - 1 ? { ...msg, content: rawTextBuffer.trim() } : msg
                    );
                  } else {
                    // Create new assistant message
                    return [...prev, {
                      role: 'assistant' as const,
                      content: rawTextBuffer.trim(),
                      sources: [],
                      formatted: false
                    }];
                  }
                });
              } else {
                // Update existing assistant message with accumulated content
                setMessages(prev => prev.map((msg, idx) => {
                  if (idx === prev.length - 1 && msg.role === 'assistant') {
                    return { ...msg, content: rawTextBuffer.trim() };
                  }
                  return msg;
                }));
              }
            }

            // Blank line indicates end of the current SSE event
            if (line.trim() === '') {
              if (currentEvent && eventDataLines.length > 0) {
                const payload = eventDataLines.join('\n');
                if (currentEvent === 'final') {
                  console.log("DEBUG: Processing final event, raw payload:", payload);

                  // Try to parse JSON payload from backend
                  let finalContent = payload;
                  try {
                    const parsed = JSON.parse(payload);
                    if (parsed.content) {
                      finalContent = parsed.content;
                      console.log("DEBUG: Extracted content from JSON payload, length:", finalContent.length);
                    } else if (parsed.text) {
                      finalContent = parsed.text;
                      console.log("DEBUG: Extracted text from JSON payload, length:", finalContent.length);
                    }
                  } catch {
                    console.log("DEBUG: Payload is not JSON, treating as plain text");
                  }

                  finalBuffer = finalContent;
                  accumulatedContent = finalContent;

                  // Handle final event - ensure assistant message exists and update content
                  setMessages(prev => {
                    const lastMessage = prev[prev.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                      // Update existing assistant message
                      return prev.map((msg, idx) =>
                        idx === prev.length - 1 ? { ...msg, content: finalContent, formatted: true } : msg
                      );
                    } else {
                      // No assistant message exists, create one (cached response case)
                      console.log("DEBUG: Creating new assistant message for final/cached response");
                      return [...prev, { role: 'assistant' as const, content: finalContent, sources: [], formatted: true }];
                    }
                  });
                  // Drain any pending typewriter buffer and stop it
                  typewriterRef.current.buffer = "";
                  if (typewriterRef.current.timer) {
                    clearInterval(typewriterRef.current.timer);
                    typewriterRef.current.timer = null;
                  }
                }
                // Ignore start/ping/delta for now
              }
              // Reset accumulator for next event
              currentEvent = null;
              eventDataLines = [];
              continue;
            }

            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
              eventDataLines = [];
              continue;
            }
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                // Stream complete
                console.log("DEBUG: Stream completed with [DONE], marking last message as formatted");
                setMessages(prev => prev.map((msg, idx) => {
                  if (idx === prev.length - 1 && msg.role === 'assistant') {
                    console.log("DEBUG: Marking assistant message as formatted");
                    return { ...msg, formatted: true };
                  }
                  return msg;
                }));
                streamFinished = true;
                break;
              }

              // Try to parse as JSON and handle final_md type
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'final_md' && parsed.content) {
                  console.log("DEBUG: Received final_md content, length:", parsed.content.length);
                  // Ensure assistant message exists and update content
                  setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant') {
                      // Update existing assistant message
                      return prev.map((msg, idx) =>
                        idx === prev.length - 1 ? { ...msg, content: parsed.content, formatted: true } : msg
                      );
                    } else {
                      // Create new assistant message
                      return [...prev, {
                        role: 'assistant' as const,
                        content: parsed.content,
                        sources: [],
                        formatted: true
                      }];
                    }
                  });
                  receivedFirstDeltaRef.current = true;
                  hasProcessedEvents = true;
                  streamFinished = true;
                  break;
                }
              } catch {
                // Not valid JSON, treat as regular data
              }

              // Collect data lines for the current event
              eventDataLines.push(data);

              // Handle different event types
              if (currentEvent === 'start' && data === 'ok') {
                console.log("DEBUG: Stream started successfully");
                // Stream initialization - no action needed
              } else if (currentEvent === 'delta' && data && !streamFinished) {
                // On first delta, ensure assistant message exists
                if (!receivedFirstDeltaRef.current) {
                  receivedFirstDeltaRef.current = true;
                  // Check if assistant message already exists, create if not
                  setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant') {
                      // Assistant message already exists, just return current state
                      return prev;
                    } else {
                      // Create new assistant message
                      return [...prev, { role: 'assistant' as const, content: '', sources: [], formatted: false }];
                    }
                  });
                }
                typewriterRef.current.buffer += data;
                startTypewriter();
              } else if (currentEvent === 'message' && data === '[DONE]') {
                // Alternative [DONE] format from backend
                console.log("DEBUG: Stream completed with message [DONE], marking last message as formatted");
                setMessages(prev => prev.map((msg, idx) => {
                  if (idx === prev.length - 1 && msg.role === 'assistant') {
                    console.log("DEBUG: Marking assistant message as formatted");
                    return { ...msg, formatted: true };
                  }
                  return msg;
                }));
                streamFinished = true;
                break;
              }
              continue;
            }
          }

          if (streamFinished) break;
        }

        reader.releaseLock();
      } catch (error) {
        console.error("Error in streaming:", error);
        console.log("DEBUG: Stream error occurred, creating error message");

        // Create error message on stream failure
        setMessages(prev => [...prev, {
          role: 'assistant' as const,
          content: "I apologize, but I'm unable to generate a response at the moment. Please try again.",
          sources: [],
          formatted: true
        }]);

        // Check if we have any accumulated content to show
        if (accumulatedContent.trim()) {
          // If assistant message exists, replace it; otherwise add new assistant error message
          if (receivedFirstDeltaRef.current) {
            setMessages(prev => {
              const lastMessage = prev[prev.length - 1];
              if (lastMessage && lastMessage.role === 'assistant') {
                return prev.map((msg, idx) =>
                  idx === prev.length - 1 ? { ...msg, content: accumulatedContent + "\n\n[Response was cut off due to an error]", formatted: true } : msg
                );
              } else {
                return [...prev, { role: 'assistant', content: accumulatedContent + "\n\n[Response was cut off due to an error]", formatted: true, sources: [] }];
              }
            });
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: accumulatedContent + "\n\n[Response was cut off due to an error]", formatted: true, sources: [] }]);
          }
        } else {
          // Error text
          const errText = 'Sorry, I encountered an error. Please try again.';
          if (receivedFirstDeltaRef.current) {
            setMessages(prev => {
              const lastMessage = prev[prev.length - 1];
              if (lastMessage && lastMessage.role === 'assistant') {
                return prev.map((msg, idx) =>
                  idx === prev.length - 1 ? { ...msg, content: errText, formatted: true } : msg
                );
              } else {
                return [...prev, { role: 'assistant', content: errText, formatted: true, sources: [] }];
              }
            });
          } else {
            setMessages(prev => [...prev, { role: 'assistant', content: errText, formatted: true, sources: [] }]);
          }
        }
      } finally {
        setLoading(false);
        streamingRef.current = false;

        // Stop typewriter to prevent race conditions
        if (typewriterRef.current.timer) {
          clearInterval(typewriterRef.current.timer);
          typewriterRef.current.timer = null;
        }

        // Clear any remaining buffer to prevent further updates
        typewriterRef.current.buffer = "";

        // Only handle final message if stream didn't complete normally
        if (!streamFinished) {
          console.log("DEBUG: Stream didn't complete normally, handling final message");
          if (receivedFirstDeltaRef.current) {
            // Update the existing assistant message with final content if available
            console.log("DEBUG: Updating existing assistant message with final content");
            setMessages(prev => prev.map((msg, idx) => {
              if (idx !== prev.length - 1) return msg;
              if (msg.role !== 'assistant') return msg;
              if (msg.formatted) return msg;
              const content = finalBuffer && finalBuffer.length ? finalBuffer : msg.content;
              return { ...msg, content, formatted: true };
            }));
          } else if (finalBuffer && finalBuffer.trim().length) {
            // No deltas received, add final message directly
            console.log("DEBUG: No deltas received, adding final message directly");
            setMessages(prev => [...prev, { role: 'assistant', content: finalBuffer, formatted: true, sources: [] }]);
          } else {
            console.log("DEBUG: No final content to add, receivedFirstDelta:", receivedFirstDeltaRef.current, "finalBuffer length:", finalBuffer?.length || 0);
          }
        } else {
          console.log("DEBUG: Stream completed normally, skipping final message handling");
        }
      }
    } catch (error) {
      console.error("Error in chat stream:", error);
      setLoading(false);
      streamingRef.current = false;

      const errText = 'Sorry, I encountered an error. Please try again.';
      if (receivedFirstDeltaRef.current) {
        // Update the existing assistant message with error
        setMessages(prev => {
          const lastMessage = prev[prev.length - 1];
          if (lastMessage && lastMessage.role === 'assistant') {
            return prev.map((msg, idx) =>
              idx === prev.length - 1 ? { ...msg, content: errText, formatted: true } : msg
            );
          } else {
            return [...prev, { role: 'assistant', content: errText, formatted: true, sources: [] }];
          }
        });
      } else {
        // No assistant message exists yet, add error message
        setMessages(prev => [...prev, { role: 'assistant', content: errText, formatted: true, sources: [] }]);
      }
    }
  };


  return {
    messages,
    setMessages,
    input,
    setInput,
    loading,
    setLoading,
    pendingFiles,
    setPendingFiles,
    sendMessage,
    updateSessionTitle
  };
}
