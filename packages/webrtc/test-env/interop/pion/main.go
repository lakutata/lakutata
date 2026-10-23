// The client of Pion (Go) in the interop tests (test-env/interop/run.sh): it joins the room interop of the signaling of
// @lakutata/webrtc over JSON-RPC 2.0 (WebSocket), as section 14 of the guide describes it, answers the offers of the
// member node, echoes the messages of its channel echo, and exits with 0 on bye, 1 after 90 seconds.
//
//	go run . ws://<server>:3001/ [relay]
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

// A message of the server: an answer to a request, or a notification (an event, its payload first in params)
type message struct {
	ID     *int              `json:"id"`
	Method string            `json:"method"`
	Params []json.RawMessage `json:"params"`
	Result json.RawMessage   `json:"result"`
	Error  json.RawMessage   `json:"error"`
}

// The answer to webrtc.join
type joinResult struct {
	PeerID     string `json:"peerId"`
	IceServers []struct {
		URLs       any    `json:"urls"`
		Username   string `json:"username"`
		Credential string `json:"credential"`
	} `json:"iceServers"`
}

// The event webrtc:signal
type signalEvent struct {
	Room        string                     `json:"room"`
	From        string                     `json:"from"`
	Description *webrtc.SessionDescription `json:"description"`
	Candidate   *webrtc.ICECandidateInit   `json:"candidate"`
}

type client struct {
	socket     *websocket.Conn
	writing    sync.Mutex
	nextID     int
	answers    map[int]chan message
	answering  sync.Mutex
	config     webrtc.Configuration
	connection *webrtc.PeerConnection
	described  bool
	held       []webrtc.ICECandidateInit
}

func log(format string, args ...any) {
	fmt.Printf("pion: "+format+"\n", args...)
}

func fail(format string, args ...any) {
	log(format, args...)
	os.Exit(1)
}

// Send a request and wait for its answer
func (c *client) request(method string, params any) message {
	c.answering.Lock()
	c.nextID++
	id := c.nextID
	answer := make(chan message, 1)
	c.answers[id] = answer
	c.answering.Unlock()
	c.writing.Lock()
	err := c.socket.WriteJSON(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	c.writing.Unlock()
	if err != nil {
		fail("cannot send %s: %v", method, err)
	}
	select {
	case result := <-answer:
		if len(result.Error) > 0 {
			fail("%s failed: %s", method, result.Error)
		}
		return result
	case <-time.After(15 * time.Second):
		fail("%s was not answered", method)
	}
	return message{}
}

// The offers and the candidates of the member node
func (c *client) signal(event signalEvent) {
	if event.Description != nil && event.Description.Type == webrtc.SDPTypeOffer {
		if c.connection == nil {
			connection, err := webrtc.NewPeerConnection(c.config)
			if err != nil {
				fail("cannot create the connection: %v", err)
			}
			c.connection = connection
			connection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
				log("connection %s", state)
			})
			connection.OnDataChannel(func(channel *webrtc.DataChannel) {
				log("channel %s", channel.Label())
				channel.OnMessage(func(received webrtc.DataChannelMessage) {
					text := string(received.Data)
					if text == "bye" {
						log("bye")
						time.Sleep(500 * time.Millisecond)
						os.Exit(0)
					}
					if err := channel.SendText("echo: " + text); err != nil {
						fail("cannot echo: %v", err)
					}
				})
			})
		}
		if err := c.connection.SetRemoteDescription(*event.Description); err != nil {
			fail("cannot set the offer: %v", err)
		}
		c.described = true
		for _, candidate := range c.held {
			_ = c.connection.AddICECandidate(candidate)
		}
		c.held = nil
		answer, err := c.connection.CreateAnswer(nil)
		if err != nil {
			fail("cannot answer: %v", err)
		}
		gathered := webrtc.GatheringCompletePromise(c.connection)
		if err := c.connection.SetLocalDescription(answer); err != nil {
			fail("cannot set the answer: %v", err)
		}
		<-gathered
		go c.request("webrtc.signal", map[string]any{"room": event.Room, "to": event.From, "description": c.connection.LocalDescription()})
		return
	}
	if event.Candidate != nil && event.Candidate.Candidate != "" {
		if !c.described {
			c.held = append(c.held, *event.Candidate)
			return
		}
		if err := c.connection.AddICECandidate(*event.Candidate); err != nil {
			log("candidate refused: %v", err)
		}
	}
}

func main() {
	if len(os.Args) < 2 {
		fail("usage: go run . ws://<server>:3001/ [relay]")
	}
	time.AfterFunc(90*time.Second, func() { fail("timed out") })
	socket, _, err := websocket.DefaultDialer.Dial(os.Args[1]+"?id=pion", nil)
	if err != nil {
		fail("cannot connect: %v", err)
	}
	c := &client{socket: socket, answers: map[int]chan message{}}
	signals := make(chan signalEvent, 100)
	go func() {
		for {
			var received message
			if err := socket.ReadJSON(&received); err != nil {
				fail("the signaling closed: %v", err)
			}
			if received.ID != nil {
				c.answering.Lock()
				answer := c.answers[*received.ID]
				delete(c.answers, *received.ID)
				c.answering.Unlock()
				if answer != nil {
					answer <- received
				}
				continue
			}
			if received.Method == "webrtc:signal" && len(received.Params) > 0 {
				var event signalEvent
				if err := json.Unmarshal(received.Params[0], &event); err == nil {
					signals <- event
				}
			}
		}
	}()
	joined := c.request("webrtc.join", map[string]any{"room": "interop", "session": "pion"})
	var result joinResult
	if err := json.Unmarshal(joined.Result, &result); err != nil {
		fail("cannot read the join: %v", err)
	}
	for _, server := range result.IceServers {
		urls := []string{}
		switch value := server.URLs.(type) {
		case string:
			urls = append(urls, value)
		case []any:
			for _, url := range value {
				urls = append(urls, fmt.Sprint(url))
			}
		}
		c.config.ICEServers = append(c.config.ICEServers, webrtc.ICEServer{URLs: urls, Username: server.Username, Credential: server.Credential})
	}
	if len(os.Args) > 2 && os.Args[2] == "relay" {
		c.config.ICETransportPolicy = webrtc.ICETransportPolicyRelay
	}
	log("joined as %s, %d ICE servers", result.PeerID, len(c.config.ICEServers))
	for event := range signals {
		c.signal(event)
	}
}
