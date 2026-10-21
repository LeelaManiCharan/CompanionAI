# Requirements Document

## Introduction

AI Companion Check-in is a zero-cost, web-based proof of concept (POC) of an AI companion that behaves like a caring friend. The companion proactively "calls" the user once per day to ask how they are doing, using an in-browser voice call (with text chat as a fallback). The companion personalizes conversations by extracting memories from chats and by learning the user's typical in-app activity times. All data is stored locally in the browser, with an optional user-triggered, client-side-encrypted cloud backup and restore to a Supabase (free tier) Storage bucket. The POC supports up to 3 local profiles per browser and includes wellbeing safeguards such as crisis detection and healthy-use boundaries.

The POC is deployed live on Vercel (connected to a GitHub repository) so that anyone with the link can use it over HTTPS. It supports two Model_Providers behind a Model_Router abstraction: Ollama, a model server running on the user's own machine that the browser calls directly, and Gemini (Google Gemini free tier), which the browser reaches only through the Generate_Route, a Next.js server route running on Vercel that holds the Gemini_Server_Key. In the default "auto" Provider_Mode, the Companion_App uses Ollama when a health check succeeds and otherwise falls back to Gemini, showing the active Model_Provider in a Provider_Badge. Access to the whole Companion_App, the Generate_Route, and the Provider_Status_Route requires signing in with Supabase Auth (email and password) per Requirement 22, so the shared Gemini free-tier quota is consumed only by signed-in users; a small set of per-user preferences is synced to a Supabase table so they follow the user across browsers. When Gemini is used, chat context leaves the browser and is sent to Google through the Generate_Route, and the Companion_App discloses this to the user.

## Glossary

- **Companion_App**: The Next.js web application as a whole, including the Home_Page, Chat_Page, and Voice_Call_Interface.
- **Home_Page**: The landing/dashboard page of the Companion_App.
- **Chat_Page**: The in-app page for text conversations with the Companion.
- **Voice_Call_Interface**: The full-page in-browser voice call screen.
- **Companion**: The AI persona the user talks to, defined by a Bot_Name and Tone.
- **Bot_Name**: The user-chosen display name of the Companion.
- **Tone**: The user-chosen personality style of the Companion, one of: cheerful, calm, playful.
- **Profile**: A local user identity within one browser, holding its own Chats, Memories, Activity_Logs, and Settings.
- **Active_Profile**: The Profile currently selected in the Companion_App.
- **Profile_Manager**: The component that creates, selects, edits, and deletes Profiles.
- **Chat**: A conversation session consisting of an ordered list of Messages, belonging to one Profile.
- **Message**: A single turn in a Chat, authored by either the user or the Companion.
- **Chat_Service**: The component that sends user Messages with context to the Model_Router and stores the Companion reply.
- **Model_Provider**: An AI text-generation backend. The POC supports exactly two values: ollama (a model server running on the user's own machine, called directly from the browser over HTTP at the configured Ollama base URL) and gemini (the Google Gemini free-tier API, called only by the Generate_Route on the server, never directly from the browser).
- **Model_Router**: The provider-agnostic component in the browser that selects the active Model_Provider according to the Provider_Mode and routes generation requests to it, defined as an abstraction so additional Model_Providers can be added later without changing callers.
- **Provider_Mode**: The per-Profile Settings value that controls Model_Provider selection, exactly one of: auto (default; use ollama when the Ollama_Health_Check succeeds, otherwise gemini), ollama (use only ollama), or gemini (use only gemini).
- **Ollama_Health_Check**: An HTTP GET request from the browser to `<Ollama base URL>/api/tags` that succeeds when Ollama returns an HTTP 2xx response within 2 seconds.
- **Active_Provider**: The Model_Provider that the Model_Router currently uses for generation requests for the Active_Profile.
- **Provider_Badge**: A small UI label, shown on the Home_Page, Chat_Page, and Voice_Call_Interface, naming the Active_Provider (for example, "Ollama (local)" or "Gemini (hosted)").
- **Generate_Route**: The public Next.js server route `/api/generate`, running on Vercel, that accepts generation requests from the browser over HTTPS POST and forwards them to Gemini using the Gemini_Server_Key.
- **Provider_Status_Route**: The public Next.js server route `/api/provider-status`, running on Vercel, that reports over HTTPS GET whether the gemini Model_Provider is available and which Gemini model name is configured, without revealing the Gemini_Server_Key.
- **Gemini_Server_Key**: The Google Gemini API key, read only from the Vercel server environment variable GEMINI_API_KEY. The Gemini_Server_Key is not an API_Key: the user never enters, sees, or stores it.
- **Gemini_Model_Name**: The Gemini model identifier used by the Generate_Route, read from the server environment variable GEMINI_MODEL, defaulting to "gemini-2.0-flash" when GEMINI_MODEL is unset or empty.
- **Rate_Limiter**: The best-effort, in-memory, per-client-IP request limiter applied by the Generate_Route.
- **Gemini_Privacy_Notice**: The disclosure stating that, when the gemini Model_Provider is used, the chat context of each request (system prompt, Profile_Summary, Memories, and recent Messages) is sent from the browser to the Generate_Route on Vercel and from there to Google.
- **Deployment**: The production build of the Companion_App hosted on Vercel, built from the connected GitHub repository and served over HTTPS.
- **API_Key**: A user-supplied credential entered in Settings; in the POC the only API_Key is the Supabase anon key used by the Cloud_Store.
- **Backup_Passphrase**: A user-entered secret of 8 to 128 characters used to derive the encryption key for a Backup_Document; held in memory only for the duration of one backup or restore operation.
- **Backup_Namespace_ID**: A random identifier generated locally once per browser, used as the folder prefix for that browser's backups in the Cloud_Store.
- **Speech_Recognizer**: The browser Web Speech API speech-to-text capability.
- **Speech_Synthesizer**: The browser speechSynthesis text-to-speech capability.
- **Memory**: A structured fact derived from a Chat, of category fact, mood, event, or person, linked to its source Chat.
- **Memory_Extractor**: The component that derives Memories from Messages using the Model_Router.
- **Memory_Store**: The component that persists, queries, and deletes Memories in the Local_Store.
- **Profile_Summary**: A fixed-length text summary of the user maintained per Profile and injected into every conversation.
- **Context_Builder**: The component that assembles the system prompt, Profile_Summary, relevant Memories, and recent Messages for each generation request.
- **Activity_Log**: A record of an in-app session for a Profile (start time, end time, duration, page).
- **Activity_Tracker**: The component that records Activity_Logs and computes the user's Preferred_Check_In_Time.
- **Preferred_Check_In_Time**: The time of day computed from Activity_Logs at which the Companion schedules the Daily_Check_In.
- **Daily_Check_In**: The once-per-day proactive Companion outreach prompting the user to start a voice call or chat.
- **Check_In_Scheduler**: The component that schedules and triggers Daily_Check_Ins.
- **Notification_Service**: The component that displays browser notifications using the Notification API and, optionally, a service worker.
- **Safety_Monitor**: The component that scans user Messages for crisis or self-harm language and surfaces help resources.
- **Crisis_Resources**: A displayed panel of real help resources, including the 988 Suicide and Crisis Lifeline (call or text 988) and emergency services (911).
- **Settings**: Per-Profile configuration including Bot_Name, Tone, Provider_Mode, Ollama base URL and model name, Gemini_Privacy_Notice acknowledgement, activity tracking consent, and notification preferences.
- **Settings_Manager**: The component that reads and writes Settings.
- **Local_Store**: The browser IndexedDB database used for all primary persistence.
- **Backup_Serializer**: The component that serializes Local_Store data into a Backup_Document and parses a Backup_Document back into Local_Store data.
- **Backup_Document**: A versioned JSON document containing Profiles, Chats, Messages, Memories, Activity_Logs, and Settings (excluding API_Keys, cloudStoreConfig credentials, and the Backup_Passphrase).
- **Backup_Metadata**: A record describing a Backup_Document (backup ID, created time, schema version, Profile count, size in bytes, checksum).
- **Backup_Service**: The component that uploads Backup_Documents to and downloads them from the Cloud_Store.
- **Cloud_Store**: A user-configured Supabase (free tier) project, identified by its project URL and anon key, whose Storage bucket (default name "companion-backups") holds encrypted Backup_Documents under the Backup_Namespace_ID.
- **Tab_Coordinator**: The component that coordinates multiple open Companion_App tabs in the same browser (leader election and change broadcasting).
- **Auth_Service**: The component that wraps Supabase Auth (email and password sign-up, sign-in, sign-out, password reset) and exposes the signed-in user and session to the Companion_App.
- **Auth_Middleware**: The Next.js middleware that refreshes the Supabase cookie session and redirects unauthenticated page requests to /login.
- **Public_Auth_Pages**: The pages /login, /signup, and /reset-password, which are the only pages reachable without a signed-in user.
- **User_Preferences**: The per-user row in the Supabase table `user_preferences` holding display_name, bot_name, tone, provider_mode, ollama_base_url, ollama_model, check_in_time_override, activity_tracking_enabled, notifications_enabled, and updated_at.
- **Preferences_Sync**: The component that seeds the primary Profile from User_Preferences and upserts local changes back to User_Preferences.
- **Primary_Profile**: The first-created (oldest createdAt) local Profile for the signed-in user; the only Profile whose Settings sync with User_Preferences.
- **Setup_Screen**: The screen shown instead of the Companion_App when required Supabase environment variables are missing.

## Requirements

### Requirement 1: Local Profiles

**User Story:** As a user, I want up to 3 local profiles in my browser under my signed-in account (Requirement 22), so that different people or personas can use the companion separately.

#### Acceptance Criteria

1. WHEN the user submits the Profile creation form with a display name that is 1 to 40 characters long after leading and trailing whitespace is trimmed, THE Profile_Manager SHALL save a new Profile with the trimmed display name to the Local_Store and set that Profile as the Active_Profile.
2. WHILE 3 Profiles exist in the Local_Store, THE Profile_Manager SHALL disable the Profile creation control and display a message stating that the limit is 3 Profiles.
3. WHEN the user selects a Profile, THE Companion_App SHALL set that Profile as the Active_Profile, record the selection time as that Profile's last-used time in the Local_Store, and display only the Chats, Memories, Activity_Logs, and Settings belonging to the Active_Profile.
4. WHEN the user selects the confirm option in a deletion confirmation prompt that shows the Profile's display name, THE Profile_Manager SHALL delete the Profile and all Chats, Messages, Memories, Activity_Logs, and Settings belonging to that Profile from the Local_Store, and SHALL leave all data unchanged if the user selects the cancel option instead.
5. WHEN the Companion_App starts and zero Profiles exist in the Local_Store, THE Companion_App SHALL display the Profile creation screen.
6. WHEN the Companion_App starts and one or more Profiles exist in the Local_Store, THE Companion_App SHALL set the Profile with the latest recorded last-used time as the Active_Profile.
7. IF the submitted display name is empty or contains only whitespace, or is longer than 40 characters after trimming, THEN THE Profile_Manager SHALL reject the submission, create no Profile, keep the entered text in the form, and display an error message stating that the display name must be 1 to 40 characters.
8. IF the deleted Profile was the Active_Profile, THEN THE Companion_App SHALL set the remaining Profile with the latest last-used time as the Active_Profile, or SHALL display the Profile creation screen if zero Profiles remain.
9. IF a Local_Store read or write fails during Profile creation, selection, or deletion, THEN THE Profile_Manager SHALL display an error message stating that the operation failed and SHALL leave all Profiles and their data in the state they were in before the operation.

### Requirement 2: Companion Personality

**User Story:** As a user, I want to choose my companion's name and tone, so that the companion feels personal to me.

#### Acceptance Criteria

1. WHEN the user submits a Bot_Name for the Active_Profile, THE Settings_Manager SHALL remove leading and trailing whitespace from the submitted value and, if the result is 1 to 30 characters long, save it in IndexedDB as the Bot_Name of the Active_Profile, replacing the previous Bot_Name.
2. WHEN the user selects a Tone for the Active_Profile, THE Settings_Manager SHALL save exactly one Tone value from the set {cheerful, calm, playful} in IndexedDB as the Tone of the Active_Profile, replacing the previous Tone.
3. WHEN a new Profile is created, THE Settings_Manager SHALL assign that Profile a default Bot_Name of "Sunny" and a default Tone of calm.
4. WHEN the Context_Builder assembles a generation request, THE Context_Builder SHALL include the Bot_Name and Tone currently saved for the Active_Profile in the system prompt, matching the saved values character for character.
5. WHEN the Settings_Manager saves a changed Bot_Name or Tone, THE Companion_App SHALL use the new values for every Companion Message generated after the save, and SHALL leave Companion Messages generated before the save unchanged.
6. IF a submitted Bot_Name is 0 characters or longer than 30 characters after leading and trailing whitespace is removed, THEN THE Settings_Manager SHALL reject the submission, keep the previous Bot_Name of the Active_Profile, and show an error message saying the Bot_Name must be 1 to 30 characters.
7. IF saving a Bot_Name or Tone to IndexedDB fails, THEN THE Settings_Manager SHALL keep the previously saved Bot_Name and Tone of the Active_Profile and show an error message saying the setting was not saved.
8. WHEN the Companion_App is reloaded, THE Settings_Manager SHALL load the Bot_Name and Tone last saved in IndexedDB for the Active_Profile and use them in place of the defaults.

### Requirement 3: Home Page

**User Story:** As a user, I want a home dashboard, so that I can quickly start a call or chat and see my check-in status.

#### Acceptance Criteria

1. WHEN the Home_Page loads, THE Home_Page SHALL display the Active_Profile name, the Bot_Name, and the Preferred_Check_In_Time formatted in the browser's local time zone.
2. THE Home_Page SHALL display one control that starts a voice call and one control that navigates to the Chat_Page, both reachable by keyboard and labeled with an accessible name.
3. WHEN the Home_Page loads, THE Home_Page SHALL display a list of up to 50 of the Active_Profile's Chats ordered by most recent Message time, descending, with each list item showing the Chat's most recent Message time and navigating to that Chat in the Chat_Page when selected.
4. IF the Active_Profile has zero Chats, THEN THE Home_Page SHALL display an empty-state message indicating no conversations exist, in place of the Chat list.
5. WHEN the Home_Page loads, THE Home_Page SHALL display today's Daily_Check_In status for the Active_Profile as "completed" if a Daily_Check_In was completed between 00:00 and 23:59 of the current local calendar date, and as "not completed" otherwise.
6. THE Home_Page SHALL display one control each that navigates to Settings, Profile switching, and Backup.
7. IF reading the Active_Profile, Chats, or Daily_Check_In data from IndexedDB fails, THEN THE Home_Page SHALL display an error message indicating the data could not be loaded, keep the voice call, Chat_Page, Settings, Profile switching, and Backup controls available, and leave stored data unmodified.

### Requirement 4: Text Chat

**User Story:** As a user, I want to chat with my companion by text, so that I can talk when voice is unavailable or inconvenient.

#### Acceptance Criteria

1. WHEN the user submits a Message containing 1 to 4,000 characters, at least one of which is not whitespace, on the Chat_Page, THE Chat_Service SHALL store the Message in the Local_Store with the user as sender and a submission timestamp, display it on the Chat_Page, clear the input field, and request a Companion reply from the Model_Router.
2. WHEN the Model_Router returns a reply within 60 seconds of the request, THE Chat_Service SHALL store the reply as a Companion Message with a timestamp in the same Chat in the Local_Store and display the reply on the Chat_Page after the user Message it answers.
3. WHILE a Companion reply is pending, THE Chat_Page SHALL display a typing indicator and keep the submit control disabled, and THE Chat_Page SHALL remove the typing indicator within 1 second after the reply is displayed or a failure is reported.
4. WHEN the user opens an existing Chat, THE Chat_Page SHALL display all Messages of that Chat from the Local_Store in ascending order of timestamp, oldest first, with each Message labelled as a user Message or a Companion Message.
5. WHEN the user starts a new Chat, THE Chat_Service SHALL create a Chat with zero Messages linked to the Active_Profile, store it in the Local_Store, and display it on the Chat_Page as the current Chat.
6. IF the input field is empty or contains only whitespace characters, THEN THE Chat_Page SHALL keep the submit control disabled, send no request to the Model_Router, and leave the Chat unchanged in the Local_Store.
7. IF the Model_Router returns an error or does not return a reply within 60 seconds of the request, THEN THE Chat_Service SHALL keep the user Message stored in the Local_Store, store no Companion Message for that request, and THE Chat_Page SHALL display an error message indicating the reply failed, along with a retry control that sends the same Message to the Model_Router again.
8. IF the Local_Store fails to save a user Message, THEN THE Chat_Service SHALL send no request to the Model_Router, and THE Chat_Page SHALL display an error message indicating the Message was not saved and keep the Message text in the input field.
9. IF the user tries to enter more than 4,000 characters in the input field, THEN THE Chat_Page SHALL stop accepting characters past 4,000 and show the current character count against the 4,000-character limit.

### Requirement 5: Voice Call Interface

**User Story:** As a user, I want a full-page voice call with my companion in the browser, so that a check-in feels like talking to a friend on the phone.

#### Acceptance Criteria

1. WHEN the user starts a voice call, THE Voice_Call_Interface SHALL display a full-page call screen that shows the Bot_Name, the elapsed call duration in MM:SS format (starting at 00:00 and updating every 1 second), a mute control, and an end-call control. Each control SHALL be operable by keyboard and have an accessible label.
2. WHEN a voice call starts, THE Voice_Call_Interface SHALL request microphone permission from the browser before starting the Speech_Recognizer.
3. WHEN the user grants microphone permission, THE Voice_Call_Interface SHALL speak one Companion greeting using the Speech_Synthesizer, display the greeting text as a caption, store the greeting as a Companion Message in the call's Chat, and start the Speech_Recognizer after the greeting finishes speaking.
4. WHEN the Speech_Recognizer produces a final transcript of user speech that contains at least 1 non-whitespace character, THE Chat_Service SHALL store the transcript as a user Message in the call's Chat and request a Companion reply. Final transcripts that are empty or whitespace-only SHALL be discarded without storing a Message or requesting a reply.
5. WHEN the Companion reply is returned during a voice call, THE Speech_Synthesizer SHALL speak the reply, THE Chat_Service SHALL store the reply as a Companion Message in the call's Chat, and THE Voice_Call_Interface SHALL display the reply text as a caption that stays visible until the next caption replaces it or the call ends.
6. WHILE the Speech_Synthesizer is speaking, THE Voice_Call_Interface SHALL pause the Speech_Recognizer, and SHALL resume the Speech_Recognizer within 1 second after speaking finishes, unless the call is muted or has ended.
7. WHILE the call is muted, THE Voice_Call_Interface SHALL stop sending user speech to the Speech_Recognizer, SHALL store no user Messages from speech captured during the muted period, and SHALL show the mute control in a visibly and programmatically indicated "muted" state. When the user unmutes, recognition SHALL resume within 1 second.
8. WHEN the user activates the end-call control, THE Voice_Call_Interface SHALL stop the Speech_Recognizer and cancel any in-progress Speech_Synthesizer speech within 1 second, stop the call duration timer, and save the call transcript as a Chat containing every Message stored during the call in chronological order.
9. IF the browser does not support the Speech_Recognizer, THEN THE Voice_Call_Interface SHALL not start the call, SHALL display a message stating that voice calls require Chrome or Edge, and SHALL offer a control that opens the Chat_Page.
10. IF the user denies or dismisses microphone permission, THEN THE Voice_Call_Interface SHALL not start the Speech_Recognizer, SHALL display an explanation that microphone access is required for voice calls, and SHALL offer a control that opens the Chat_Page.
11. IF the Chat_Service fails to return a Companion reply within 15 seconds or returns an error during a voice call, THEN THE Voice_Call_Interface SHALL display a caption indicating the Companion could not respond, keep the user's transcript Message stored in the call's Chat, keep the call active, and resume the Speech_Recognizer so the user can speak again. The 15-second limit applies only to this voice-specific caption fallback; the underlying Model_Router request SHALL follow the 60-second timeout and error handling defined in Requirement 6 for the Active_Provider.
13. IF a Companion reply arrives more than 15 seconds but no more than 60 seconds after the request while the call is still active, THEN THE Chat_Service SHALL store the reply as a Companion Message in the call's Chat and THE Voice_Call_Interface SHALL display the reply as a caption.
14. IF a late Companion reply as defined in criterion 13 arrives while the Speech_Recognizer has detected user speech that started after the fallback caption was shown, THEN THE Speech_Synthesizer SHALL leave the reply unspoken; otherwise THE Speech_Synthesizer SHALL speak the reply under the pause and resume rules of criterion 6.
12. IF the Speech_Recognizer stops or reports an error while the call is active and not muted, THEN THE Voice_Call_Interface SHALL restart the Speech_Recognizer automatically up to 3 consecutive times. After 3 failed restarts, it SHALL display a message indicating that voice recognition is unavailable and offer a control that opens the Chat_Page, keeping all Messages stored so far in the call's Chat.

### Requirement 6: Model Provider Configuration

**User Story:** As a user, I want the companion to use my local Ollama model when it is running and fall back to a hosted Gemini model when it is not, so that anyone with the link can use the companion at no cost while I can keep conversations on my machine when I choose.

#### Acceptance Criteria

Provider selection

1. THE Model_Router SHALL route every generation request (Companion replies, Memory extraction, Profile_Summary regeneration, and connection tests) to exactly one Model_Provider from the set {ollama, gemini} through a provider-agnostic interface, so that additional Model_Providers can be added later without changing the Chat_Service, Memory_Extractor, or Context_Builder.
2. THE Settings_Manager SHALL allow the user to select the Provider_Mode for the Active_Profile from {auto, ollama, gemini}, SHALL assign auto to every newly created Profile, and SHALL persist the saved Provider_Mode so that the value remains in effect after the page is reloaded.
3. THE Settings_Manager SHALL allow the user to configure the Ollama base URL (an absolute http or https URL of 1 to 2,048 characters) and Ollama model name (1 to 100 characters with no leading or trailing whitespace) for the Active_Profile, with defaults of http://localhost:11434 and llama3.1:8b, and SHALL persist the saved values so that they remain in effect after the page is reloaded.
4. WHILE the Provider_Mode is auto, WHEN the Companion_App starts, the Active_Profile changes, the Provider_Mode or Ollama base URL is saved, or a generation request starts more than 60 seconds after the previous Ollama_Health_Check, THE Model_Router SHALL run the Ollama_Health_Check and set the Active_Provider to ollama if the Ollama_Health_Check succeeds, or to gemini if the Ollama_Health_Check fails or does not complete within 2 seconds.
5. WHILE the Provider_Mode is ollama, THE Model_Router SHALL set the Active_Provider to ollama and SHALL send zero requests to the Generate_Route.
6. WHILE the Provider_Mode is gemini, THE Model_Router SHALL set the Active_Provider to gemini and SHALL send zero generation requests to the Ollama base URL.
7. THE Companion_App SHALL display the Provider_Badge naming the Active_Provider on the Home_Page, Chat_Page, and Voice_Call_Interface, and SHALL update the Provider_Badge within 1 second whenever the Active_Provider changes.
8. WHILE the Provider_Mode is auto and the Active_Provider is gemini because the Ollama_Health_Check failed, THE Provider_Badge SHALL indicate that the Companion_App fell back to the hosted model (for example, "Gemini (hosted, Ollama not detected)").
9. IF, WHILE the Provider_Mode is auto, a generation request to ollama fails because the connection is refused or the browser blocks the response for cross-origin (CORS) reasons, THEN THE Model_Router SHALL set the Active_Provider to gemini, update the Provider_Badge per criterion 8, and resend the same request once to the Generate_Route, subject to criterion 21.
10. WHEN a generation request starts, THE Model_Router SHALL use the Active_Provider, Ollama base URL, and Ollama model name in effect for the Active_Profile at the moment the request starts.

Ollama

11. IF Ollama returns an error or does not respond within 60 seconds, THEN THE Model_Router SHALL return an error and THE Companion_App SHALL display a message identifying Ollama as the failing Model_Provider and a retry control, keeping the user's unsent input and the existing conversation unchanged; in auto Provider_Mode, connection and CORS failures follow criterion 9 instead.
12. IF, WHILE the Provider_Mode is ollama, a generation or test request to Ollama fails because the connection is refused or the browser blocks the response for cross-origin (CORS) reasons, THEN THE Companion_App SHALL display a message stating that Ollama could not be reached at the configured base URL, instructing the user to start Ollama, and instructing the user to set the OLLAMA_ORIGINS environment variable to include the Companion_App's origin (displaying that origin, for example the Vercel domain) if Ollama is already running.
13. IF Ollama reports that the configured model is not installed, THEN THE Companion_App SHALL display a message naming the configured model and showing the command `ollama pull <model>` with the configured model name substituted for `<model>`.
14. IF the user tries to save an Ollama base URL or Ollama model name that does not meet the constraints in criterion 3, THEN THE Settings_Manager SHALL reject the save, display an error message identifying the invalid field, and keep the previously saved values.

Gemini

15. THE Model_Router SHALL send every gemini generation request from the browser only to the Generate_Route of the Companion_App's own origin, and SHALL send zero requests from the browser directly to any Google API endpoint.
16. WHEN the Companion_App starts and WHEN the Provider_Mode is saved as auto or gemini, THE Model_Router SHALL request the Provider_Status_Route and record whether the gemini Model_Provider is available.
17. IF the Provider_Status_Route reports that the gemini Model_Provider is unavailable because GEMINI_API_KEY is not set on the server, THEN THE Companion_App SHALL show gemini as unavailable in Settings and in the Provider_Badge, SHALL display a message stating that the hosted model is not configured on this Deployment and that the user can run Ollama locally, and SHALL send zero generation requests to the Generate_Route.
18. IF the Generate_Route returns HTTP 429 because Gemini reported a quota or rate-limit error or because the Rate_Limiter rejected the request, THEN THE Companion_App SHALL display a message stating that the hosted model is busy or its quota is reached and that the user can try again later or run Ollama locally, together with a retry control, and SHALL keep the user's Message and the existing conversation unchanged.
19. IF the Generate_Route returns an error other than HTTP 429, or does not respond within 60 seconds, THEN THE Model_Router SHALL return an error and THE Companion_App SHALL display a message identifying Gemini as the failing Model_Provider and a retry control, keeping the user's unsent input and the existing conversation unchanged.
20. IF neither Model_Provider is usable (in auto Provider_Mode the Ollama_Health_Check fails and gemini is unavailable per criterion 17), THEN THE Companion_App SHALL display a message stating that no model is available, with instructions to start Ollama with OLLAMA_ORIGINS set to the Companion_App's origin, and SHALL send zero generation requests.
21. WHEN the Model_Router is about to send the first gemini generation request for a Profile whose Settings record no Gemini_Privacy_Notice acknowledgement, THE Companion_App SHALL display the Gemini_Privacy_Notice with a continue control and a cancel control, SHALL send the request only after the user selects continue, and SHALL then store the acknowledgement time in that Profile's Settings so that the notice is shown at most once per Profile.
22. IF the user selects cancel on the Gemini_Privacy_Notice, THEN THE Model_Router SHALL send zero requests to the Generate_Route, and THE Companion_App SHALL keep the user's Message and input unchanged and display a message stating that a reply requires either acknowledging the notice or running Ollama locally.
23. THE Settings_Manager SHALL display the Gemini_Privacy_Notice text in the model provider section of Settings at all times, whether or not the user has acknowledged the notice.
24. WHILE the Active_Provider is gemini, IF the assembled generation request body would exceed 64 KB (65,536 bytes of UTF-8 JSON), THEN THE Context_Builder SHALL remove the oldest Messages from the request, keeping the system prompt, Profile_Summary, Memories, and the latest user Message, until the body is 64 KB or smaller.

Connection test and retry

25. WHEN the user activates a test-connection control in Settings, THE Model_Router SHALL send a test request to the Model_Provider selected for testing (ollama using the currently entered base URL and model name, or gemini through the Generate_Route), disable the control until the test completes, and within 60 seconds display either a success indication naming the Model_Provider and model name or the error returned (treating no response within 60 seconds as a timeout error).
26. WHEN the user activates a retry control described in criteria 11, 18, or 19, THE Model_Router SHALL resend the same request using the Active_Provider and provider settings currently in effect for the Active_Profile.

### Requirement 6A: Generate Route Security

**User Story:** As the POC owner, I want the public hosted generation endpoint to be hardened, so that the Gemini key stays secret and the shared free-tier quota is protected from casual abuse.

#### Acceptance Criteria

1. THE Generate_Route SHALL accept only HTTP POST requests with a `Content-Type` of `application/json`, and IF a request uses any other method, THEN THE Generate_Route SHALL return HTTP 405 with an `Allow: POST` header and SHALL send zero requests to Gemini.
2. IF a request body is larger than 64 KB (65,536 bytes), THEN THE Generate_Route SHALL return HTTP 413 without parsing the body and SHALL send zero requests to Gemini.
3. THE Generate_Route SHALL validate every request body with a zod schema requiring: task (exactly one of: reply, extract_memories, summarize, test), system (string of 1 to 20,000 characters), and messages (list of 1 to 20 entries, each with role exactly one of user or companion and content of 1 to 10,000 characters), matching the context limits of Requirement 9 criterion 1 and the Message content limit of Requirement 19 criterion 4, and SHALL reject unknown top-level fields.
4. IF a request body is not valid JSON or fails the zod schema in criterion 3, THEN THE Generate_Route SHALL return HTTP 400 with an error code and the names of the failing fields, and SHALL send zero requests to Gemini.
5. THE Rate_Limiter SHALL allow at most 20 requests per signed-in user id (falling back to client IP address only when no user id is available) per rolling 60-second window per server instance, using in-memory state that is best-effort and may reset when the server instance restarts or differ across instances.
6. IF a user (or client IP address) exceeds the limit in criterion 5, THEN THE Generate_Route SHALL return HTTP 429 with a `Retry-After` header in seconds and an error code distinguishing a local rate limit from a Gemini quota error, and SHALL send zero requests to Gemini.
7. IF Gemini returns HTTP 429 or a quota-exhausted error, THEN THE Generate_Route SHALL return HTTP 429 with an error code identifying a Gemini quota or rate-limit error.
8. IF GEMINI_API_KEY is not set or is empty on the server, THEN THE Generate_Route SHALL return HTTP 503 with an error code stating that the gemini Model_Provider is not configured, and THE Provider_Status_Route SHALL report the gemini Model_Provider as unavailable.
9. WHEN a valid request is received and GEMINI_API_KEY is set, THE Generate_Route SHALL send the request to Gemini using the Gemini_Model_Name, abort the Gemini request if no response arrives within 50 seconds and return HTTP 504, and otherwise return the generated text with HTTP 200.
10. IF Gemini returns any error other than those in criterion 7, THEN THE Generate_Route SHALL return HTTP 502 with a generic error code and message.
11. THE Generate_Route and Provider_Status_Route SHALL exclude the Gemini_Server_Key, any substring of the Gemini_Server_Key, the upstream request URL containing the key, and raw upstream error bodies from every response body, response header, and server log entry.
12. THE Generate_Route SHALL store zero request or response content in any server-side database, file, or log, logging at most the HTTP status, error code, task, and request duration.
13. THE Generate_Route and Provider_Status_Route SHALL require a valid Supabase session per Requirement 22 criterion 6, and THE Companion_App SHALL state, in the Gemini_Privacy_Notice section of Settings and in the README, that only signed-in users can use the Generate_Route, that the shared Gemini free-tier quota is shared among all signed-in users, and that the Rate_Limiter is best-effort only.
14. THE Provider_Status_Route SHALL accept only HTTP GET requests and SHALL return only a boolean indicating whether the gemini Model_Provider is available and the Gemini_Model_Name, returning HTTP 405 with an `Allow: GET` header for any other method.

### Requirement 7: API Key Handling

**User Story:** As a user, I want to supply my own Supabase anon key securely, and as the POC owner I want the Gemini key kept only on the server, so that no credentials are embedded in the app or exposed to the browser.

#### Acceptance Criteria

1. THE Companion_App SHALL obtain the default Supabase project URL and anon key from the public environment variables NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (public by design and protected by Row Level Security, per Requirement 22), and SHALL additionally allow a manual override anon key entered in Settings; zero API_Key values SHALL be present in source code or committed configuration files.
2. THE Companion_App SHALL send the Supabase anon key only in requests to the configured Supabase project URL.
3. IF the user activates the Backup control or the Restore control and neither the environment Supabase anon key nor a manual override anon key is available, THEN THE Settings_Manager SHALL prompt the user to enter a Supabase anon key and THE Backup_Service SHALL send zero requests to the Cloud_Store until a Supabase anon key is saved.
4. THE Settings_Manager SHALL display every stored API_Key in masked form, showing at most the last 4 characters of the key and replacing all other characters with a mask character; IF the stored API_Key is 8 characters or shorter, THEN THE Settings_Manager SHALL mask all characters.
5. WHEN the user saves an API_Key, THE Settings_Manager SHALL trim leading and trailing whitespace and store the API_Key in the Local_Store only if the trimmed value is between 1 and 256 characters and contains no internal whitespace.
6. IF the user attempts to save an API_Key that is empty after trimming, exceeds 256 characters, or contains internal whitespace, THEN THE Settings_Manager SHALL reject the save, display an error message indicating the key format is invalid, and leave any previously stored API_Key for that provider unchanged.
7. IF a Cloud_Store request fails because Supabase rejects the anon key as invalid or unauthorized, THEN THE Companion_App SHALL display an error message indicating the API_Key was rejected and directing the user to Settings, SHALL NOT retry the request automatically, and SHALL retain the stored API_Key until the user replaces or clears it.
8. THE Companion_App SHALL exclude every API_Key value from displayed error messages and browser console output.
9. THE Backup_Serializer SHALL exclude every API_Key from every Backup_Document, and restoring a Backup_Document SHALL leave the currently stored API_Keys unchanged.
10. WHEN the user clears an API_Key, THE Settings_Manager SHALL remove that API_Key from the Local_Store within 1 second, display the Cloud_Store as having no key configured, and require a new API_Key entry before the next Cloud_Store request.
11. THE Generate_Route SHALL read the Gemini_Server_Key only from the server environment variable GEMINI_API_KEY at request time, and THE Settings_Manager SHALL provide zero inputs for entering a Gemini key.
12. THE Companion_App SHALL keep the Gemini_Server_Key out of source code, committed files (including `.env.example`), the built client bundle, every `NEXT_PUBLIC_`-prefixed environment variable, every response sent to the browser, the Local_Store, and every Backup_Document.
13. THE GitHub repository SHALL exclude `.env`, `.env.local`, and every other `.env*` file except `.env.example` from version control through `.gitignore`.
14. THE Companion_App SHALL send the Supabase anon key from the browser directly to the configured Supabase project URL and SHALL send zero manually entered API_Key values to the Generate_Route, the Provider_Status_Route, or any other server route of the Deployment; the Supabase session cookies set by Supabase Auth are the only credentials sent to those routes.

### Requirement 8: Memory Extraction

**User Story:** As a user, I want the companion to remember facts about me from our chats, so that conversations feel personal over time.

#### Acceptance Criteria

1. WHEN a Chat receives a new user Message, THE Memory_Extractor SHALL derive between 0 and 5 Memories from that Message and the Companion Message immediately preceding it in the same Chat, or from the user Message alone if no preceding Companion Message exists.
2. THE Memory_Extractor SHALL assign each Memory exactly one category from the set fact, mood, event, or person, and SHALL limit each Memory's content to between 1 and 500 characters.
3. THE Memory_Store SHALL link each Memory to the ID of its source Chat and the IDs of every source Message (the user Message and, if present, the preceding Companion Message) from which it was derived.
4. WHEN the Memory_Extractor derives a Memory whose content, after trimming leading and trailing whitespace and comparing case-insensitively, is identical to the content of an existing Memory of the same category in the Active_Profile, THE Memory_Store SHALL update the existing Memory's last-updated time to the current time and append the new source Chat and Message IDs to it, without creating a second Memory.
5. IF the Model_Router returns an error during memory extraction for a Message, THEN THE Memory_Extractor SHALL leave the Memory_Store unchanged, keep the user Message and the Companion's reply delivered in the Chat, and retry extraction for that Message on each of the next successful generation requests, up to a maximum of 3 retry attempts, after which the Memory_Extractor SHALL stop retrying extraction for that Message.
6. WHEN the user opens the Memories view, THE Companion_App SHALL display every Memory of the Active_Profile with its content, category, and last-updated time, ordered by last-updated time with the most recent first, and SHALL display an empty-state message indicating no Memories exist if the Active_Profile has zero Memories.
7. WHEN the user saves an edit to a Memory in the Memories view with content between 1 and 500 characters after trimming whitespace, THE Memory_Store SHALL replace that Memory's content and category with the edited values, update its last-updated time, and retain its existing source references; IF the edited content is empty or exceeds 500 characters, THEN THE Companion_App SHALL reject the save, display an error message indicating the allowed length, and keep the Memory unchanged.
8. WHEN the user confirms deletion of a Memory in the Memories view, THE Memory_Store SHALL permanently remove that Memory, and THE Companion_App SHALL remove it from the Memories view and exclude it from all subsequent Companion generation requests.
9. IF the Model_Router returns extraction output in which a Memory has a category outside fact, mood, event, or person, or content that is empty or longer than 500 characters, THEN THE Memory_Extractor SHALL discard that Memory, store the remaining valid Memories from the same output, and leave the Memory_Store otherwise unchanged.
10. WHEN the Memory_Store appends source references to a Memory under criterion 4 and the resulting sourceChatIds or sourceMessageIds list would exceed 100 entries, THE Memory_Store SHALL remove the oldest entries from that list in first-in, first-out order until the list holds exactly 100 entries, keeping the newly appended references.
11. FOR ALL Memories after any source append, THE Memory_Store SHALL hold between 1 and 100 entries in each of sourceChatIds and sourceMessageIds (source-cap invariant).

### Requirement 9: Context Retrieval and Profile Summary

**User Story:** As a user, I want the companion to recall relevant things I said before and a summary of who I am, so that it responds like a friend who knows me.

#### Acceptance Criteria

1. WHEN the Context_Builder assembles a generation request, THE Context_Builder SHALL include, in this order, the system prompt, the Profile_Summary of the Active_Profile, between 0 and 10 Memories ranked in descending order of relevance to the latest user Message, and between 0 and 20 of the most recent Messages of the current Chat in chronological order.
2. WHEN the Active_Profile has fewer than 10 stored Memories or the current Chat has fewer than 20 Messages, THE Context_Builder SHALL include all available Memories or Messages respectively, without padding or placeholder entries.
3. WHEN the Active_Profile has no Profile_Summary, THE Context_Builder SHALL omit the Profile_Summary section and still include the system prompt, the available Memories, and the available Messages.
4. THE Context_Builder SHALL include only Memories that belong to the Active_Profile, and SHALL include zero Memories belonging to any other profile.
5. WHEN a Chat ends, or WHEN 10 new Memories have been stored for the Active_Profile since the last Profile_Summary update, THE Memory_Extractor SHALL regenerate the Profile_Summary from the Active_Profile's Memories and reset the new-Memory count to 0.
6. THE Memory_Extractor SHALL produce a Profile_Summary of no more than 1,500 characters, and IF a generated summary exceeds 1,500 characters, THEN THE Memory_Extractor SHALL truncate it to 1,500 characters before storing it.
7. WHEN the user opens the Profile_Summary view, THE Companion_App SHALL display the current Profile_Summary of the Active_Profile and allow the user to edit and save it, and THE Context_Builder SHALL use the saved Profile_Summary in the next generation request.
8. IF the user attempts to save an edited Profile_Summary longer than 1,500 characters, THEN THE Companion_App SHALL reject the save, display an error message indicating the 1,500-character limit, and retain both the previously stored Profile_Summary and the user's unsaved edit in the editor.
9. IF Memory retrieval or Profile_Summary regeneration fails, THEN THE Companion_App SHALL keep the previously stored Profile_Summary unchanged, and THE Context_Builder SHALL proceed with the generation request using the system prompt, the stored Profile_Summary, and the recent Messages without retrieved Memories.

### Requirement 10: Chat Deletion and Forgetting

**User Story:** As a user, I want deleting a chat to make the companion truly forget it, so that I stay in control of what it knows about me.

#### Acceptance Criteria

1. WHEN the user activates the delete control for a Chat, THE Chat_Service SHALL show a confirmation prompt with confirm and cancel options, and SHALL leave the Chat, its Messages, and all Memories unchanged until the user picks confirm.
2. WHEN the user confirms deletion of a Chat, THE Chat_Service SHALL delete the Chat and all of its Messages from the Local_Store and remove the Chat from the chat list within 2 seconds, and SHALL leave Chats belonging to other Profiles unchanged.
3. WHEN a Chat is deleted, THE Memory_Store SHALL delete every Memory whose sourceChatIds contains only that Chat's ID.
4. WHEN a Chat is deleted, THE Memory_Store SHALL remove that Chat's ID from the sourceChatIds of every Memory that has one or more other source Chats, and SHALL keep those Memories with their remaining sourceChatIds.
5. WHEN a Chat is deleted and the deletion of its Messages and Memories has finished, THE Memory_Extractor SHALL regenerate the Profile_Summary using only the remaining Memories of the Active_Profile, and IF zero Memories remain, THEN THE Memory_Extractor SHALL set the Profile_Summary to empty.
6. FOR ALL Chats, after deletion of a Chat, THE Memory_Store SHALL contain zero Memories whose sourceChatIds include the deleted Chat ID, and THE Profile_Summary SHALL not be derived from any Memory that was deleted (forgetting invariant).
7. WHEN the user activates the reset control for the Active_Profile, THE Companion_App SHALL show a confirmation prompt with confirm and cancel options; WHEN the user confirms, THE Companion_App SHALL delete all Chats, Messages, Memories, and the Profile_Summary of the Active_Profile, keep the Profile and Settings unchanged, and leave data of other Profiles unchanged.
8. IF deleting a Chat, its Messages, or its associated Memories fails partway through, THEN THE Chat_Service SHALL restore the Chat, its Messages, and its Memories to their state before deletion, show an error message saying the deletion failed, and keep the Chat in the chat list so the user can try again.
9. IF Profile_Summary regeneration fails after a Chat is deleted (for example, because the language model is unavailable or returns an error), THEN THE Memory_Extractor SHALL clear the existing Profile_Summary instead of keeping it, and SHALL regenerate it from the remaining Memories on the next successful Memory extraction or app load.
10. IF Memory extraction is in progress for a Chat when that Chat is deleted, THEN THE Memory_Extractor SHALL discard the extraction result and SHALL not write any Memory that references the deleted Chat ID.

### Requirement 11: Activity Tracking and Consent

**User Story:** As a user, I want to know what activity is tracked and be able to opt out, so that personalization respects my privacy.

#### Acceptance Criteria

1. WHEN a Profile is created, THE Companion_App SHALL display a disclosure, before any Activity_Log is recorded for that Profile, stating that the tracked data consists only of session start time, session end time, session duration, and page visited, and that this data is used only for scheduling check-ins.
2. WHILE activity tracking is enabled for the Active_Profile, THE Activity_Tracker SHALL record exactly one Activity_Log per session, where a session begins when the Companion_App tab becomes visible and ends when the tab becomes hidden or is closed, and each Activity_Log contains the session start time, session end time, session duration in seconds, and page visited.
3. WHILE activity tracking is disabled for the Active_Profile, THE Activity_Tracker SHALL record zero Activity_Logs, including for any session that was in progress at the moment tracking was disabled.
4. WHEN the user changes the activity tracking toggle in the Settings_Manager for the Active_Profile, THE Settings_Manager SHALL apply the new setting within 1 second, persist it in IndexedDB so that it remains in effect after a page reload, and retain existing Activity_Logs unchanged.
5. WHEN the user activates the clear-activity control and confirms the action in a confirmation prompt, THE Activity_Tracker SHALL delete all Activity_Logs of the Active_Profile, leave Activity_Logs of other Profiles unchanged, and leave zero Activity_Logs of the Active_Profile in the listing view; IF the user cancels the confirmation prompt, THEN THE Activity_Tracker SHALL retain all Activity_Logs unchanged.
6. THE Companion_App SHALL provide a view listing all Activity_Logs of the Active_Profile sorted by session start time with the most recent first, showing the session start time, end time, duration, and page for each entry, and showing an empty-state message when the Active_Profile has zero Activity_Logs.
7. WHEN the user selects opt-in or opt-out in the disclosure, THE Companion_App SHALL store the choice with the Profile in IndexedDB and set activity tracking to enabled for opt-in or disabled for opt-out; IF the user dismisses the disclosure without making a choice, THEN THE Companion_App SHALL set activity tracking to disabled for that Profile.
8. IF an IndexedDB write or delete operation for an Activity_Log, the consent choice, or the tracking setting fails, THEN THE Companion_App SHALL display an error message indicating that the operation failed and SHALL keep the previously stored data and setting unchanged.

### Requirement 12: Daily Check-in Scheduling

**User Story:** As a user, I want the companion to check in at a time when I'm usually around, so that the call feels natural rather than intrusive.

#### Acceptance Criteria

1. WHILE activity tracking is enabled AND Activity_Logs for the Active_Profile contain sessions on at least 3 distinct local calendar dates AND no fixed check-in time override is set, THE Activity_Tracker SHALL compute the Preferred_Check_In_Time as HH:00 (24-hour local time), where HH is the hour (00–23) with the highest count of session starts across the most recent 14 local calendar dates of Activity_Logs, breaking ties by selecting the hour of the most recent session start among the tied hours.
2. WHEN a new Activity_Log session start is recorded for the Active_Profile, THE Activity_Tracker SHALL recompute the Preferred_Check_In_Time per criterion 1 before the next scheduling evaluation on that local date.
3. WHILE no fixed check-in time override is set AND (activity tracking is disabled OR Activity_Logs for the Active_Profile contain sessions on fewer than 3 distinct local calendar dates), THE Check_In_Scheduler SHALL use 19:00 local time as the Preferred_Check_In_Time.
4. THE Settings_Manager SHALL allow the user to set a fixed check-in time override for the Active_Profile in 24-hour HH:MM format at 1-minute granularity within the range 00:00 to 23:59, and to clear that override; WHILE an override is set, THE Check_In_Scheduler SHALL use the override as the Preferred_Check_In_Time regardless of activity tracking state or Activity_Log count.
5. IF the user submits a fixed check-in time override that is outside 00:00–23:59 or not in HH:MM format, THEN THE Settings_Manager SHALL reject the value, display an error message indicating the valid time format and range, and retain the previously saved Preferred_Check_In_Time setting unchanged.
6. WHILE the Companion_App is open, WHEN the local time reaches the Preferred_Check_In_Time and no Daily_Check_In has been completed for the Active_Profile on the current local calendar date, THE Check_In_Scheduler SHALL trigger a Daily_Check_In within 60 seconds of the Preferred_Check_In_Time.
7. WHEN the user snoozes a triggered Daily_Check_In, THE Check_In_Scheduler SHALL trigger exactly 1 snooze reminder 30 minutes later on the same local calendar date, provided no Daily_Check_In has been completed for the Active_Profile in the interim and the snooze reminder time does not fall after 23:59 of that date.
8. THE Check_In_Scheduler SHALL trigger at most 1 Daily_Check_In and at most 1 snooze reminder per Profile per local calendar date, including when the Preferred_Check_In_Time changes on that date after a Daily_Check_In has already been triggered.
9. WHEN the user starts a voice call or sends a Chat Message for the Active_Profile on a local calendar date, THE Check_In_Scheduler SHALL mark the Daily_Check_In for that Profile and date as completed and SHALL cancel any pending Daily_Check_In or snooze reminder for that date.
10. WHEN the Companion_App opens after the Preferred_Check_In_Time has passed on the current local calendar date and no Daily_Check_In has been completed for the Active_Profile on that date, THE Home_Page SHALL display a check-in prompt from the Companion, at most once per Profile per local calendar date, and this display SHALL count as the triggered Daily_Check_In for that date under criterion 8.

### Requirement 13: Browser Notifications

**User Story:** As a user, I want a browser notification when my companion "calls", so that I don't miss my daily check-in.

#### Acceptance Criteria

1. WHEN the user turns on the check-in notifications setting and the browser notification permission state is "default" (not yet granted or denied), THE Notification_Service SHALL request browser notification permission exactly once for that action.
2. WHEN the user turns on the check-in notifications setting and the browser notification permission state is already "granted", THE Notification_Service SHALL enable check-in notifications without showing a permission request.
3. WHEN a Daily_Check_In is triggered while browser notification permission is "granted" and the check-in notifications setting is on, THE Notification_Service SHALL display exactly one notification for that Daily_Check_In whose title contains the Bot_Name and whose body contains a check-in message of 1 to 120 characters.
4. WHEN the user clicks a Daily_Check_In notification, THE Companion_App SHALL focus an existing open Companion_App tab, or open a new one if none is open, SHALL display the Voice_Call_Interface for the Active_Profile within 3 seconds, and SHALL close the clicked notification.
5. WHEN the user selects snooze on a Daily_Check_In prompt or notification, THE Check_In_Scheduler SHALL cancel the current prompt and schedule one reminder for 30 minutes (±1 minute) after the snooze selection, allowing exactly 1 snooze per Daily_Check_In per local calendar date (consistent with Requirement 12 criteria 7 and 8). After the 1 snooze has been used, the snooze option SHALL no longer be shown for that Daily_Check_In.
6. IF browser notification permission is "denied", or the user dismisses the permission request without granting it, THEN THE Settings_Manager SHALL show the check-in notifications setting as off and display a message stating that check-ins will appear only as in-app prompts. THE Check_In_Scheduler SHALL keep delivering Daily_Check_In events as in-app prompts.
7. WHERE service worker support is available, THE Notification_Service SHALL register a service worker to display Daily_Check_In notifications while the Companion_App tab is open in the background (not the focused tab).
8. IF the browser does not support the Notification API, THEN THE Settings_Manager SHALL disable the check-in notifications setting and display a message stating that this browser does not support notifications and check-ins will appear only as in-app prompts.
9. IF service worker registration fails, THEN THE Notification_Service SHALL display Daily_Check_In notifications from the open Companion_App page instead, and SHALL keep all saved notification settings unchanged.

### Requirement 14: Crisis Detection

**User Story:** As a user, I want the companion to point me to real help if I express thoughts of self-harm, so that I can get support from people qualified to help.

#### Acceptance Criteria

1. WHEN a user Message is received, whether typed on the Chat_Page or transcribed from speech during a voice call, THE Safety_Monitor SHALL scan the full Message text for crisis or self-harm language. Matching SHALL ignore letter case, punctuation and repeated whitespace, and the scan SHALL finish before the generation request is sent to the Model_Provider.
2. WHEN the Safety_Monitor detects crisis or self-harm language, THE Companion_App SHALL display the Crisis_Resources on the current page within 1 second of the Message being submitted. The Crisis_Resources SHALL stay visible until the user explicitly dismisses them, and showing them SHALL NOT navigate away from the current page or clear the conversation.
3. WHEN the Safety_Monitor detects crisis or self-harm language during a voice call, THE Speech_Synthesizer SHALL speak a supportive message that names the 988 Suicide and Crisis Lifeline and 911 for immediate danger, and SHALL speak it before any Companion reply to that Message, while the Crisis_Resources are displayed on the Voice_Call_Interface.
4. WHEN the Safety_Monitor detects crisis or self-harm language, THE Context_Builder SHALL add a safety instruction to the generation request for that Message. The instruction SHALL direct the Companion to respond supportively, avoid giving instructions or methods related to self-harm, and encourage contacting the Crisis_Resources.
5. THE Companion_App SHALL provide a help control on the Home_Page, Chat_Page and Voice_Call_Interface. The control SHALL be visible without scrolling when the page first renders, SHALL work with mouse, touch and keyboard, and SHALL display the Crisis_Resources within 1 second of activation.
6. THE Safety_Monitor SHALL perform detection using a local keyword and phrase list without making any network request, so detection works even when the Model_Provider or network connectivity is unavailable.
7. THE Crisis_Resources display SHALL show, as on-screen text readable without audio, the 988 Suicide and Crisis Lifeline with the instruction to call or text 988, and 911 for immediate danger.
8. IF the Safety_Monitor has detected crisis or self-harm language and the Model_Provider is unavailable or the generation request fails, THEN THE Companion_App SHALL keep the Crisis_Resources displayed and SHALL show a fallback supportive message naming the 988 Suicide and Crisis Lifeline in place of the Companion reply, with the user's Message kept in the conversation.
9. WHEN the Safety_Monitor detects crisis or self-harm language in a later Message after the user has dismissed the Crisis_Resources, THE Companion_App SHALL display the Crisis_Resources again under the same rules as criterion 2.

### Requirement 15: Healthy Boundaries

**User Story:** As a user, I want the companion to be honest about what it is and encourage real-world connection, so that I use it in a healthy way.

#### Acceptance Criteria

1. WHEN the Context_Builder assembles a generation request, THE Context_Builder SHALL include in the system prompt an instruction stating that the Companion is an AI, is not a human, is not a therapist or medical professional, must not provide medical or psychological diagnoses, and must not claim to be human in any reply.
2. WHEN the user sends a Message asking whether the Companion is a human, a real person, a therapist, or a medical professional, THE Companion SHALL reply with a Message stating that the Companion is an AI and is not a human or a therapist.
3. THE Home_Page SHALL display a disclaimer, visible on initial page load without user interaction and not dismissible, stating that the Companion is an AI and is not a substitute for professional help.
4. WHEN the Context_Builder assembles a generation request, THE Context_Builder SHALL include in the system prompt an instruction to encourage the user's real-world relationships and activities and to not present the Companion as a replacement for people in the user's life.
5. WHEN the sum of Activity_Log durations for the Active_Profile on the current local calendar date first exceeds 2 hours, THE Companion_App SHALL display a non-blocking, dismissible break suggestion that does not close the current Chat_Page or Voice_Call_Interface and does not discard any unsent Message input.
6. WHILE a voice call is active in the Voice_Call_Interface, THE Companion_App SHALL defer the break suggestion from criterion 5 and display the break suggestion when the voice call ends.
7. WHEN the break suggestion has been displayed for the Active_Profile on a local calendar date, THE Companion_App SHALL not display the break suggestion again for that Profile on that local calendar date, including after page reload, browser restart, or switching Profiles and back.
8. IF an Activity_Log session spans local midnight, THEN THE Companion_App SHALL count only the portion of that session's duration falling within the current local calendar date toward the 2-hour threshold.

### Requirement 16: Local Persistence

**User Story:** As a user, I want my data stored locally in my browser, so that the POC works without a server database and keeps my data on my device.

#### Acceptance Criteria

1. WHEN a Profile, Chat, Message, Memory, Activity_Log, Settings, Profile_Summary, or Backup_Metadata record is created, updated, or deleted, THE Companion_App SHALL commit the change to the Local_Store within 1 second, and only then show the change as saved in the UI. The Companion_App SHALL NOT store these records in any server-side database, except the per-user preference fields synced to the `user_preferences` table per Requirement 22 criteria 11 to 14.
2. WHEN the Companion_App is reloaded in the same browser profile, THE Companion_App SHALL restore every committed record from the Local_Store, with all fields unchanged, before showing user data. For a Local_Store with up to 10,000 Messages, this SHALL finish within 3 seconds of page load.
3. THE Local_Store SHALL record a schema version as a positive integer, and THE Companion_App SHALL increase the current schema version by at least 1 with each schema change.
4. IF a Local_Store write fails (for example, because the storage quota is exceeded or the transaction aborts), THEN THE Companion_App SHALL show an error message saying the data was not saved, keep the unsaved Message text in the input field, leave all previously committed records unchanged, and leave no partially written record in the Local_Store.
5. FOR ALL records written to the Local_Store, reading the record by its ID SHALL return a record with the same set of fields and the same value in every field, timestamps included, as the record that was written (write/read round-trip).
6. WHEN the Companion_App opens a Local_Store whose schema version is lower than the current schema version, THE Companion_App SHALL migrate all records to the current schema version before showing user data, keeping every record ID and all user-entered content, and SHALL then set the stored schema version to the current schema version.
7. IF a schema migration fails, or the Local_Store's schema version is higher than the current schema version, THEN THE Companion_App SHALL leave the existing Local_Store data and schema version unchanged, show an error message saying the data could not be loaded, and not write to the Local_Store during that session.
8. IF the Local_Store cannot be opened (for example, because IndexedDB is blocked or not supported by the browser), THEN THE Companion_App SHALL show an error message within 3 seconds of page load saying that local storage is unavailable and data will not be saved, and SHALL disable the actions that create or change records.

### Requirement 17: Backup Serialization

**User Story:** As a user, I want my data exported in a reliable format, so that a backup can be restored without loss.

#### Acceptance Criteria

1. WHEN a backup is requested, THE Backup_Serializer SHALL serialize every Profile in the Local_Store, together with all of each Profile's Chats, Messages, Memories, Activity_Logs, Profile_Summaries, and Settings, into a single Backup_Document that contains a schema version (a positive integer), an export timestamp, and a checksum computed over the serialized data payload (everything except the checksum value itself).
2. THE Backup_Serializer SHALL exclude all API keys, all cloudStoreConfig credentials, and the Backup_Passphrase from every Backup_Document, so that none of these values appears anywhere in the serialized output, including inside Settings.
3. WHEN a Backup_Document is provided that is valid JSON, declares a schema version supported by the current application, has a checksum matching its data payload, and contains all required fields, THE Backup_Serializer SHALL parse it into Local_Store records whose field values equal those of the records that were serialized, ignoring any fields not defined in the supported schema version.
4. IF a Backup_Document has invalid JSON, declares a schema version that is missing, non-integer, or not supported by the current application (including versions newer than the current one), has a checksum mismatch, or is missing required fields, THEN THE Backup_Serializer SHALL return an error that names the failure category (invalid JSON, unsupported schema version, checksum mismatch, or missing required field, with the name of the first missing field) and SHALL leave all Local_Store records unchanged.
5. IF a Backup_Document contains a record that references a parent that is not in the same document (for example, a Chat whose Profile is absent, or a Message whose Chat is absent), THEN THE Backup_Serializer SHALL return an error identifying the record type and the missing parent reference, and SHALL leave all Local_Store records unchanged.
6. IF a provided Backup_Document is larger than 50 MB, THEN THE Backup_Serializer SHALL reject it without parsing, return an error indicating the size limit was exceeded, and leave all Local_Store records unchanged.
7. THE Backup_Serializer SHALL output Backup_Documents as UTF-8 JSON indented with 2 spaces per nesting level, with object keys in lexicographic order at every nesting level and collection entries in a deterministic order, so that serializing the same Local_Store data twice gives byte-identical output apart from the export timestamp and the checksum.
8. FOR ALL valid Local_Store datasets, including a dataset with zero Profiles and Profiles that have zero Chats, Messages, Memories, Activity_Logs, or Profile_Summaries, serializing then parsing then serializing SHALL produce a Backup_Document byte-identical to the first serialization, excluding the export timestamp field (round-trip property).

### Requirement 18: Cloud Backup and Restore

**User Story:** As a user, I want to back up and restore my data to the cloud, so that I don't lose my companion's memory if I clear my browser or switch devices.

#### Acceptance Criteria

1. THE Cloud_Store SHALL default to the Supabase project given by NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY with bucket "companion-backups" and SHALL be treated as configured whenever those variables are set, with no manual entry required (Requirement 22 criterion 16). As an optional manual override, THE Settings_Manager SHALL allow the user to enter, edit, and save the Supabase project URL (an absolute https URL of 1 to 2,048 characters), the Supabase anon key (validated per Requirement 7 criterion 5), and the Storage bucket name (1 to 63 characters of lowercase letters, digits, and hyphens, default "companion-backups"). The Settings_Manager SHALL treat the Cloud_Store as configured only when the project URL, anon key, and bucket name are all non-empty and saved.
2. WHEN the user activates the Backup control, the Cloud_Store is configured, and the user has entered a valid Backup_Passphrase, THE Backup_Service SHALL encrypt the Backup_Document and upload the encrypted object to the configured Supabase Storage bucket under the path prefix `${userId}/${Backup_Namespace_ID}/` when using the default environment project (or the Backup_Namespace_ID prefix alone for a manual override project without auth). Once the upload succeeds, it SHALL store Backup_Metadata in the Local_Store. The Backup_Metadata SHALL contain the backup timestamp, the size in bytes, and the Backup_Document schema version.
3. WHEN a backup upload completes successfully, THE Companion_App SHALL display a success indication with the backup date and time in the user's local time zone (minute precision) and the backup size in KB or MB (one decimal place). The display SHALL appear within 1 second of completion.
4. IF the user activates the Backup control or the Restore control and the Cloud_Store is not configured, THEN THE Companion_App SHALL display a message saying that cloud storage is not configured, with a link that opens the Cloud_Store settings. THE Companion_App SHALL send no request to the Cloud_Store.
5. IF a backup upload fails, or does not complete within 30 seconds, THEN THE Backup_Service SHALL display an error message that includes the error returned by the Cloud_Store (or says the request timed out). It SHALL leave the previous Backup_Metadata and all Local_Store data unchanged.
6. WHEN the user activates the Restore control and the Cloud_Store is configured, THE Backup_Service SHALL list up to 50 of the most recent backups stored under the Backup_Namespace_ID in the configured bucket, newest first. Each entry SHALL show its Backup_Metadata (timestamp and size).
7. WHEN the user selects a backup to restore, THE Companion_App SHALL show a confirmation prompt warning that all current Local_Store data will be replaced. THE Companion_App SHALL replace no data unless the user explicitly confirms.
8. WHEN the user confirms restore of a selected backup and enters a Backup_Passphrase, THE Backup_Service SHALL download the encrypted object, decrypt it with a key derived from the entered Backup_Passphrase, and validate the resulting Backup_Document. A Backup_Document is valid when it parses fully, declares a schema version the Companion_App supports, and contains every required data section. Only after validation passes SHALL the Backup_Service replace all Local_Store data with the restored data as a single operation and display a success indication.
9. IF validation of a downloaded or imported Backup_Document fails, or the download does not complete within 30 seconds, THEN THE Backup_Service SHALL display an error message stating why it failed (unreadable file, unsupported schema version, missing data, or timeout). It SHALL leave the Local_Store unchanged.
10. WHEN the user activates the Export control, THE Companion_App SHALL save the current Backup_Document as a local file to the device through the browser's download mechanism.
11. WHEN the user selects a local file with the Import control, THE Companion_App SHALL accept files up to 50 MB, rejecting larger files per Requirement 17 criterion 6. It SHALL validate the file and confirm replacement using the same rules as criteria 7 and 8 before replacing Local_Store data.
12. IF listing backups from the Cloud_Store fails or does not complete within 30 seconds, THEN THE Backup_Service SHALL display an error message that includes the returned error or says it timed out. IF the Cloud_Store holds zero backups, THEN THE Backup_Service SHALL display a message saying no backups are available.
13. WHILE a backup upload, backup listing, or restore download is in progress, THE Companion_App SHALL show a progress indicator and disable the Backup, Restore, and Import controls.
14. WHEN the Companion_App starts and no Backup_Namespace_ID exists in the Local_Store, THE Backup_Service SHALL generate a Backup_Namespace_ID containing at least 128 bits of cryptographically secure randomness and store it in the Local_Store, and SHALL display the Backup_Namespace_ID in the backup settings with a copy control and an input that lets the user replace it with a Backup_Namespace_ID copied from another browser, so that backups made in that browser can be listed and restored.
15. THE Backup_Service SHALL encrypt every Backup_Document before upload using AES-GCM with a 256-bit key derived from the Backup_Passphrase and a random salt, and a unique random initialization vector per upload, storing the salt and initialization vector alongside the ciphertext in the uploaded object.
16. IF the entered Backup_Passphrase is shorter than 8 characters or longer than 128 characters, THEN THE Backup_Service SHALL reject the backup or restore, display an error message stating that the passphrase must be 8 to 128 characters, and send no request to the Cloud_Store.
17. IF decryption fails during restore (for example, because the entered Backup_Passphrase differs from the one used for the backup or the object was altered), THEN THE Backup_Service SHALL display an error message stating that the passphrase is incorrect or the backup is corrupted, and SHALL leave the Local_Store unchanged.
18. THE Backup_Service SHALL hold the Backup_Passphrase in memory only for the duration of one backup or restore operation, and SHALL exclude the Backup_Passphrase and any derived key from the Local_Store, every Backup_Document, every uploaded object, and every request sent to the Cloud_Store.
19. THE backup settings view SHALL display a notice stating that the Supabase bucket is protected by Row Level Security storage policies (provided in `supabase/schema.sql`) that restrict read and write access to objects whose first folder equals the signed-in user's id, and that backup contents are additionally protected by the Backup_Passphrase; for a manual override project, the notice SHALL state that access depends on that project's own policies.
20. FOR ALL valid Backup_Documents and valid Backup_Passphrases, encrypting then decrypting with the same Backup_Passphrase SHALL produce a Backup_Document byte-identical to the original (encryption round-trip property).

### Requirement 19: Data Models

**User Story:** As a developer, I want clearly defined data models, so that storage, context building, and backup are consistent.

#### Acceptance Criteria

1. THE Local_Store SHALL store each Profile with: id (non-empty string, unique across all Profiles), displayName (string of 1 to 40 characters after trimming leading and trailing whitespace), createdAt (timestamp), and lastUsedAt (timestamp equal to or later than createdAt).
2. THE Local_Store SHALL store at most one Settings record per Profile, containing: profileId (referencing an existing Profile), botName (string of 1 to 30 characters after trimming), tone (exactly one of: cheerful, calm, playful), providerMode (exactly one of: auto, ollama, gemini; default auto), ollamaBaseUrl (empty, or an http or https URL of at most 2,048 characters), ollamaModel (empty, or a string of at most 100 characters), geminiNoticeAcknowledgedAt (empty, or a timestamp), activityTrackingEnabled (boolean), notificationsEnabled (boolean), checkInTimeOverride (empty, or a local time in 24-hour HH:MM format from 00:00 to 23:59), cloudStoreConfig (empty, or an object with supabaseUrl (https URL of 1 to 2,048 characters), supabaseAnonKey (string of 1 to 256 characters), and bucketName (string of 1 to 63 characters, default "companion-backups") as defined in Requirement 18 criterion 1), and updatedAt (timestamp).
3. THE Local_Store SHALL store each Chat with: id (non-empty string, unique across all Chats), profileId (referencing an existing Profile), title (string of 0 to 100 characters), mode (exactly one of: text, voice), createdAt (timestamp), and updatedAt (timestamp equal to or later than createdAt).
4. THE Local_Store SHALL store each Message with: id (non-empty string, unique across all Messages), chatId (referencing an existing Chat whose profileId equals this Message's profileId), profileId (referencing an existing Profile), role (exactly one of: user, companion), content (string of 1 to 10,000 characters), createdAt (timestamp), and safetyFlagged (boolean).
5. THE Local_Store SHALL store each Memory with: id (non-empty string, unique across all Memories), profileId (referencing an existing Profile), category (exactly one of: fact, mood, event, person), content (string of 1 to 500 characters), sourceChatIds (list of 1 to 100 Chat ids), sourceMessageIds (list of 1 to 100 Message ids), createdAt (timestamp), and updatedAt (timestamp equal to or later than createdAt). A Memory with zero source Chats SHALL not exist; manually edited Memories keep their existing sources.
6. THE Local_Store SHALL store each Activity_Log with: id (non-empty string, unique across all Activity_Logs), profileId (referencing an existing Profile), startedAt (timestamp), endedAt (timestamp equal to or later than startedAt), durationSeconds (integer from 0 to 86,400 equal to the whole number of seconds between startedAt and endedAt, rounded down), and page (string of 1 to 200 characters).
7. THE Local_Store SHALL store at most one Profile_Summary per Profile, containing: profileId (referencing an existing Profile), content (string of 0 to 1,500 characters), and updatedAt (timestamp).
8. THE Local_Store SHALL store each Backup_Metadata record with: id (non-empty string, unique across all Backup_Metadata records), createdAt (timestamp), schemaVersion (positive integer), profileCount (integer of 0 or greater), sizeBytes (integer of 0 or greater), checksum (non-empty string), and location (exactly one of: cloud, file).
9. THE Local_Store SHALL store at most one Daily_Check_In record per combination of profileId and date, containing: profileId (referencing an existing Profile), date (local calendar date in YYYY-MM-DD format), triggeredAt (timestamp), snoozedUntil (empty, or a timestamp later than triggeredAt), and completedAt (empty, or a timestamp equal to or later than triggeredAt).
10. WHEN the Companion_App is about to write a record to the Local_Store, THE Companion_App SHALL validate the record against the corresponding data model in criteria 1 to 9, checking that every listed field is present, matches its stated type and allowed values, and satisfies its stated length, range, ordering, and uniqueness constraints.
11. IF a record fails validation, THEN THE Companion_App SHALL reject the write, leave any previously stored version of that record unchanged, return an error to the calling feature identifying the data model and each failing field, and log the validation error.
12. IF a record references a profileId, chatId, sourceChatId, or sourceMessageId that does not exist in the Local_Store at write time, THEN THE Companion_App SHALL treat the record as failing validation and handle it per criterion 11.
13. THE Companion_App SHALL store every timestamp field in criteria 1 to 9 as a UTC date-time with millisecond precision.
14. THE Backup_Serializer SHALL exclude the entire cloudStoreConfig object, including the Supabase anon key, and the Backup_Passphrase from every Backup_Document, and restoring a Backup_Document SHALL leave the currently stored cloudStoreConfig unchanged.
15. THE Local_Store SHALL store exactly one browser-level record, not belonging to any Profile and excluded from every Backup_Document, containing backupNamespaceId (non-empty string generated per Requirement 18 criterion 14) and createdAt (timestamp).

### Requirement 20: Edge Cases and Resilience

**User Story:** As a user, I want the companion to behave predictably when unusual things happen (multiple tabs, switching profiles mid-call, clock changes, going offline, low storage), so that my data stays correct and check-ins stay reliable.

#### Acceptance Criteria

Multiple browser tabs

1. WHILE two or more Companion_App tabs are open in the same browser, THE Tab_Coordinator SHALL designate exactly one tab as the leader tab, and only the leader tab's Check_In_Scheduler SHALL trigger Daily_Check_Ins and snooze reminders and only the leader tab's Notification_Service SHALL display Daily_Check_In notifications.
2. WHEN the leader tab is closed or becomes unresponsive, THE Tab_Coordinator SHALL designate one of the remaining open tabs as the leader tab within 5 seconds.
3. WHILE a voice call is active in one Companion_App tab, THE Tab_Coordinator SHALL disable the start-voice-call controls in every other tab and display a message stating that a call is already in progress in another tab.
4. WHEN one tab commits a change to the Local_Store, THE Tab_Coordinator SHALL notify every other open tab in the same browser (for example, via BroadcastChannel), and each notified tab SHALL display the updated data within 2 seconds without requiring a page reload.
5. IF a tab is displaying a Profile or Chat that another tab has deleted, THEN THE Companion_App SHALL leave the deleted item's view within 2 seconds of the notification, display a message stating that the item was deleted in another tab, and apply Requirement 1 criterion 8 when the deleted item was the Active_Profile.

Switching Profiles during in-flight work

6. WHEN the user switches the Active_Profile while a voice call is active, THE Voice_Call_Interface SHALL end the call per Requirement 5 criterion 8, saving the transcript to the Profile that started the call, before THE Companion_App sets the new Active_Profile.
7. IF a Companion reply, Memory extraction result, or Profile_Summary regeneration result arrives for a Profile that is no longer the Active_Profile, THEN THE Companion_App SHALL discard the result and store no Message, Memory, or Profile_Summary from that result; the user Message already stored remains in its original Chat.
8. FOR ALL records written to the Local_Store by a Chat, voice call, Memory extraction, or Profile_Summary operation, THE record's profileId SHALL equal the profileId of the Profile that was the Active_Profile when that operation started (no-cross-Profile-write invariant).

Deleting a Chat during in-flight work

9. IF the user activates the delete control for a Chat that has an active voice call, THEN THE Chat_Service SHALL keep the Chat unchanged and display a message stating that the call must be ended before the Chat can be deleted.
10. IF a Chat is deleted while a Companion reply for that Chat is pending, THEN THE Chat_Service SHALL discard the reply when the reply arrives and store no Message for the deleted Chat; pending Memory extraction for that Chat follows Requirement 10 criterion 10.

Clock, time zone, and daylight saving changes

11. WHILE the Companion_App is open, THE Check_In_Scheduler SHALL compare the current local calendar date and UTC offset with the previously observed values at least once every 60 seconds and, WHEN either value has changed, SHALL recompute the current local calendar date and the next Daily_Check_In trigger time using the new local time within 60 seconds.
12. IF the Preferred_Check_In_Time does not exist on the current local calendar date because of a daylight saving time transition, THEN THE Check_In_Scheduler SHALL trigger the Daily_Check_In at the first valid local time after the Preferred_Check_In_Time on that date; IF the Preferred_Check_In_Time occurs twice on that date, THEN THE Check_In_Scheduler SHALL trigger at the first occurrence only, consistent with Requirement 12 criterion 8.
13. THE Check_In_Scheduler SHALL determine the Daily_Check_In date, completion status, and snooze eligibility using the local calendar date at the moment of evaluation, so that a Daily_Check_In record stored for a date remains attached to that date after a time zone change.

Sleep, suspended tabs, and resume

14. WHEN the Companion_App tab resumes after the device wakes from sleep or the browser un-suspends the tab, THE Check_In_Scheduler SHALL evaluate the schedule within 5 seconds of resume and, IF the Preferred_Check_In_Time has passed on the current local calendar date and no Daily_Check_In has been triggered or completed for the Active_Profile on that date, THEN THE Check_In_Scheduler SHALL trigger the Daily_Check_In within 60 seconds of resume.
15. IF the local calendar date at resume differs from the date at suspension, THEN THE Check_In_Scheduler SHALL evaluate only the current local calendar date and trigger zero Daily_Check_Ins or snooze reminders for earlier dates.

Offline operation

16. WHILE the browser reports that it is offline, THE Chat_Service SHALL continue to send generation requests to the configured Ollama base URL, THE Model_Router SHALL treat the gemini Model_Provider as unavailable (in auto Provider_Mode using ollama if the Ollama_Health_Check succeeds, otherwise applying Requirement 6 criterion 20), and THE Companion_App SHALL disable the Backup and Restore controls and display a message stating that cloud backup and restore require a network connection; Export and Import of local files SHALL remain available.
17. WHILE the browser reports that it is offline, THE Voice_Call_Interface SHALL display a notice stating that speech recognition in some browsers requires a network connection and that text chat remains available; recognizer failures follow Requirement 5 criterion 12.
18. WHEN the browser reports that connectivity is restored, THE Companion_App SHALL re-enable the Backup and Restore controls within 5 seconds; uploads or downloads interrupted by a connectivity loss follow Requirement 18 criteria 5 and 9.

Storage quota and eviction

19. WHEN the Companion_App starts, THE Companion_App SHALL request persistent storage from the browser (for example, via navigator.storage.persist) and, IF the browser denies persistent storage, THEN THE Companion_App SHALL display a dismissible notice stating that the browser may clear local data under storage pressure and recommending a backup or export.
20. WHEN the Companion_App starts and after each Chat ends, THE Companion_App SHALL read the storage usage and quota reported by the browser (for example, via navigator.storage.estimate) and, IF usage is at or above 80% of the quota, THEN THE Companion_App SHALL display a warning showing the usage percentage and recommending deleting Chats, exporting, or backing up.
21. WHEN the Profile creation screen is displayed because zero Profiles exist (Requirement 1 criterion 5), THE Companion_App SHALL also display Restore and Import controls with a message stating that previously backed-up or exported data can be recovered, so that a user whose browser data was cleared or evicted can restore it; because no Profile Settings exist in this state, the Restore control SHALL let the user enter the Cloud_Store details defined in Requirement 18 criterion 1 and a Backup_Namespace_ID before listing backups.

Very long Chats and model output limits

22. WHILE a Chat holds more than 20 Messages, THE Context_Builder SHALL send only the 20 most recent Messages, as defined in Requirement 9 criterion 1.
23. WHILE a Chat holds more than 500 Messages, THE Chat_Page SHALL render at most 500 Messages at a time, starting with the most recent, and SHALL load earlier Messages in ascending timestamp order when the user scrolls to the top or activates a load-earlier control, preserving the ordering in Requirement 4 criterion 4.
24. IF a Companion reply from the Active_Provider exceeds 10,000 characters, THEN THE Chat_Service SHALL store and display the first 10,000 characters of the reply, consistent with the Message content limit in Requirement 19 criterion 4.
25. IF the Active_Provider returns a Companion reply that is empty or contains only whitespace, THEN THE Chat_Service SHALL treat the reply as a failed reply and apply Requirement 4 criterion 7 (or Requirement 5 criterion 11 during a voice call).
26. IF Memory extraction output from the Active_Provider is not parseable as the expected structured format, THEN THE Memory_Extractor SHALL treat the output as a Model_Router error and apply Requirement 8 criterion 5; individually invalid Memories within parseable output follow Requirement 8 criterion 9.

Restore edge cases

27. IF a Backup_Document being restored or imported contains more than 3 Profiles, THEN THE Backup_Service SHALL reject the Backup_Document, display an error message stating that a backup may contain at most 3 Profiles, and leave the Local_Store unchanged; Backup_Documents with a newer or unsupported schema version follow Requirement 17 criterion 4.
28. WHILE a voice call is active, THE Companion_App SHALL disable the Restore and Import controls and display a message stating that the call must be ended before restoring.
29. WHEN a restore or import replaces the Local_Store data, THE Companion_App SHALL discard the results of every Companion reply, Memory extraction, and Profile_Summary regeneration that was pending when the replacement started, and THE Tab_Coordinator SHALL notify every other open tab to reload its data from the Local_Store.

Safety and voice echo

30. WHEN the user deletes a Chat that contains Messages flagged by the Safety_Monitor while the Crisis_Resources are displayed, THE Chat_Service SHALL complete the deletion per Requirement 10, and THE Companion_App SHALL keep the Crisis_Resources displayed until the user dismisses them.
31. WHILE the Speech_Synthesizer is speaking, THE Speech_Recognizer SHALL be paused per Requirement 5 criterion 6; IF a final transcript received within 2 seconds after speaking finishes matches the text of the Companion Message just spoken (compared case-insensitively, ignoring punctuation and repeated whitespace), THEN THE Voice_Call_Interface SHALL discard that transcript as echo without storing a Message or requesting a reply.

### Requirement 21: Deployment

**User Story:** As the POC owner, I want the Companion_App deployed live on Vercel from GitHub with secure defaults and clear setup docs, so that anyone with the link can use it and run Ollama locally if they choose.

#### Acceptance Criteria

1. THE Companion_App SHALL build with `next build` with zero TypeScript type errors and zero build errors.
2. WHEN a commit is pushed to the production branch of the connected GitHub repository, THE Deployment SHALL be built and published by Vercel from that commit.
3. THE Deployment SHALL require the server environment variable GEMINI_API_KEY and SHALL accept the optional server environment variable GEMINI_MODEL, with GEMINI_MODEL defaulting to "gemini-2.0-flash" when unset or empty; IF GEMINI_API_KEY is unset, THEN THE Deployment SHALL still build and serve the Companion_App with the gemini Model_Provider reported unavailable per Requirement 6A criterion 8.
4. THE GitHub repository SHALL contain a `.env.example` file listing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, GEMINI_API_KEY, and GEMINI_MODEL with placeholder values only and zero real key values.
5. THE GitHub repository SHALL contain a README that documents the NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, GEMINI_API_KEY, and GEMINI_MODEL environment variables, how to apply `supabase/schema.sql`, how to set them in the Vercel project settings, and that GEMINI_API_KEY must never use a `NEXT_PUBLIC_` prefix.
6. THE README SHALL document how a user runs Ollama locally for use with the Deployment, including installing Ollama, pulling the default model with `ollama pull llama3.1:8b`, and starting Ollama with the OLLAMA_ORIGINS environment variable set to include the Deployment's Vercel domain (for example, `OLLAMA_ORIGINS=https://<project>.vercel.app`), with commands for Windows, macOS, and Linux.
7. THE README SHALL state that the Companion_App, Generate_Route, and Provider_Status_Route require a Supabase Auth sign-in, that the shared Gemini free-tier quota is shared among all signed-in users, and that chat context is sent to Google when the gemini Model_Provider is used.
8. THE README SHALL state that the default Supabase project URL and anon key come from the NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY Deployment environment variables, that the anon key is public by design and protected by Row Level Security, and that a manual Cloud_Store override remains available in Settings per Requirement 18 criterion 1.
9. THE Deployment SHALL serve the Companion_App only over HTTPS, redirecting HTTP requests to HTTPS, because microphone access and service worker registration require a secure context.
10. THE Deployment SHALL send the following response headers on every page and route response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: microphone=(self), camera=(), geolocation=()`, and `X-Frame-Options: DENY`.
11. THE Deployment SHALL store zero Profiles, Chats, Messages, Memories, Activity_Logs, Settings, or Profile_Summaries on the server, consistent with Requirement 16 criterion 1 and Requirement 6A criterion 12; the only server-side user data SHALL be Supabase Auth accounts, the `user_preferences` rows defined in Requirement 22, and encrypted backup objects.

### Requirement 22: Authentication and Per-User Preferences

**User Story:** As a user, I want to sign in to the whole app (and therefore to the AI), so that my data, preferences, and backups are tied to my account and the shared AI quota is protected; as the POC owner, I want Supabase and Gemini configured from environment files, so that users don't have to enter keys manually.

#### Acceptance Criteria

Sign-up, sign-in, sign-out, and password reset

1. WHEN the user submits the /signup form with a display name of 1 to 40 characters after trimming, a valid email address, and a password of 8 to 72 characters, THE Auth_Service SHALL create a Supabase Auth account with email and password, storing the trimmed display name in the user metadata, and SHALL show a message to confirm the email IF Supabase requires email confirmation, otherwise sign the user in and open the Home_Page.
2. WHEN the user submits valid credentials on /login, THE Auth_Service SHALL sign the user in with Supabase Auth email and password, establish the cookie session, and open the page originally requested (or the Home_Page); IF sign-in fails, THEN THE Auth_Service SHALL display a generic "email or password is incorrect" message (or the network error) without revealing whether the email exists.
3. WHEN the user submits an email on /reset-password, THE Auth_Service SHALL request a Supabase password reset email with a redirect back to /reset-password, and WHEN the user arrives from that email with a recovery session, THE /reset-password page SHALL let the user set a new password of 8 to 72 characters and then open the Home_Page.
4. WHEN the user activates the sign-out control, THE Auth_Service SHALL stop the Check_In_Scheduler, the Activity_Tracker, and any active voice call (saving the transcript per Requirement 5 criterion 8), close the user's Local_Store connection, sign out of Supabase Auth, and navigate to /login.

Route protection

5. THE Auth_Middleware SHALL, using a cookie-based Supabase session from `@supabase/ssr` (pinned to an exact version), refresh the session on every request and redirect every page request other than the Public_Auth_Pages and static assets to /login (preserving the requested path as a `next` query parameter) WHEN no signed-in user exists; WHEN a signed-in user requests a Public_Auth_Page other than a /reset-password recovery visit, it SHALL redirect to the Home_Page.
6. THE Generate_Route and Provider_Status_Route SHALL verify the session on every request by calling `supabase.auth.getUser()` with a server client built from the request cookies, and IF no valid user is returned, THEN SHALL return HTTP 401 with error code `unauthorized` and send zero requests to Gemini; this check SHALL run after the method check of Requirement 6A criteria 1 and 14 and before body parsing.
7. THE Rate_Limiter SHALL key requests by the verified user id per Requirement 6A criterion 5.

Environment configuration

8. THE Companion_App SHALL read NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (public by design, protected by Row Level Security) and the server-only GEMINI_API_KEY and GEMINI_MODEL from environment variables; THE repository SHALL contain a gitignored `.env.local` file with empty placeholders for all four variables and an updated `.env.example`, and GEMINI_API_KEY SHALL never use a `NEXT_PUBLIC_` prefix.
9. IF NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or empty, THEN THE Companion_App SHALL display the Setup_Screen listing each missing variable name (never values) and pointing to `.env.local` and the README, instead of crashing, and THE Auth_Middleware SHALL let requests through to the Setup_Screen without attempting to contact Supabase.

Per-user local data

10. WHEN a user is signed in, THE Companion_App SHALL open the Local_Store as the IndexedDB database named `companion-<userId>`, so that different users on one browser never read or write each other's Profiles, Chats, Messages, Memories, Activity_Logs, Settings, Profile_Summaries, Daily_Check_Ins, or Backup_Metadata; zero Local_Store reads or writes SHALL occur before the signed-in user id is known, and BroadcastChannel names used by the Tab_Coordinator SHALL include the user id.

Per-user preferences sync

11. THE Supabase project SHALL contain a table `user_preferences` with user_id (uuid primary key referencing auth.users, on delete cascade), display_name, bot_name, tone, provider_mode, ollama_base_url, ollama_model, check_in_time_override, activity_tracking_enabled, notifications_enabled, and updated_at, with Row Level Security enabled and select, insert, and update policies restricted to `auth.uid() = user_id`.
12. WHEN a user signs in on a browser whose `companion-<userId>` Local_Store holds zero Profiles, THE Preferences_Sync SHALL read the user's User_Preferences row and create the Primary_Profile and its Settings from it; IF no row exists, THEN it SHALL create them from the signup display name (or the email local part, truncated to 40 characters) and the default Settings, and upsert the resulting values to User_Preferences; all values SHALL be validated against Requirement 19 criteria 1 and 2, with invalid fields replaced by defaults.
13. WHEN the user saves a change to the Primary_Profile display name or to any of its synced Settings fields (botName, tone, providerMode, ollamaBaseUrl, ollamaModel, checkInTimeOverride, activityTrackingEnabled, notificationsEnabled), THE Preferences_Sync SHALL commit the change locally first and then upsert it to User_Preferences with updated_at equal to the local updatedAt; IF the upsert fails, THEN the local save SHALL remain committed and THE Companion_App SHALL show a quiet, dismissible notice that preferences could not be synced, retrying on the next change or sign-in.
14. WHEN the Companion_App starts with a signed-in user and an existing Primary_Profile, THE Preferences_Sync SHALL compare the remote updated_at with the local Settings updatedAt and apply last-write-wins: the newer remote values replace local synced fields, or newer local values are upserted.
15. THE Companion_App SHALL keep up to 3 local Profiles per user per Requirement 1; only the Primary_Profile SHALL sync with User_Preferences, and other Profiles SHALL remain local-only.

Cloud backup under the user's account

16. THE Backup_Service SHALL use the default environment Supabase project per Requirement 18 criterion 1 with the signed-in user's session (not the anon key alone) for every Storage request, uploading and listing objects under `${userId}/…`, and THE storage policies SHALL restrict select, insert, update, and delete on the backup bucket to objects where `(storage.foldername(name))[1] = auth.uid()::text`; a manual override project SHALL continue to work per Requirement 18.
17. THE repository SHALL contain `supabase/schema.sql` creating the `user_preferences` table, its Row Level Security policies, the private `companion-backups` Storage bucket, and the storage policies in criterion 16, written so it can be re-run without error.

### Requirement 24: Companion Reminders

**User Story:** As a user, I want to ask the companion to remind me about something at a time (for example "call me and remind me about watching a movie at 7:32"), so that it "calls" me at that time instead of saying it can't.

#### Acceptance Criteria

1. WHEN a user Message (typed or a final voice transcript) matches the reminder pre-filter (remind, reminder, call me, ping me, wake me, alarm, "at <digit>", or "in <n> min/hour"), THE Chat_Service SHALL send an `extract_reminder` generation request with the user text, the current UTC instant, the IANA time zone, and the local date-time, before requesting the reply; IF the extraction fails, times out (8 seconds), or returns no reminder, THEN THE Chat_Service SHALL continue with the normal reply.
2. THE Reminder_Parser SHALL accept only JSON of the form `{"reminder": {"text": "...", "due_local": "YYYY-MM-DDTHH:MM"} | null}`, resolve `due_local` in the user's time zone per Requirement 20 criterion 12, and SHALL reject reminders whose text is empty after trimming, whose due time is not in the future, or whose due time is more than 30 days ahead; reminder text SHALL be trimmed and cut to 200 characters.
3. WHEN a reminder is extracted, THE Chat_Service SHALL store a Reminder record {id, profileId, chatId (or null), text (1 to 200 characters, trimmed), dueAt (UTC timestamp), createdAt, status "pending", firedAt null} for the Active_Profile and SHALL tell the companion in the system prompt that the reminder was scheduled, so the reply confirms it in one short sentence.
4. THE Context_Builder rules SHALL state that the companion can schedule reminders and check-in calls when asked, SHALL never claim it cannot, and SHALL ask for the time when a reminder request has no clear time.
5. WHILE the Companion_App is open in a browser tab, THE Check_In_Scheduler (leader tab only) SHALL, on each tick, find pending Reminders of the Active_Profile with dueAt at or before now; a Reminder due more than 6 hours ago SHALL be marked "done" without ringing, and any other due Reminder SHALL be marked "fired" with firedAt stored before any prompt or notification is shown, so a reload cannot ring it twice.
6. WHEN a Reminder fires, THE Companion_App SHALL show an in-app prompt "{Bot_Name} is calling — Reminder: {text}" with Answer (opens `/call?from=reminder&reminder={id}`) and Dismiss, and, IF notifications are enabled and permitted, a notification titled "{Bot_Name} is calling" with body "Reminder: {text}", tag `reminder-{id}`, and a click target of the same call URL.
7. WHEN a call is started from a Reminder, THE Voice_Call_Interface SHALL greet with a Tone-specific line that includes the reminder text, and SHALL mark the Reminder "done" when the call starts.
8. THE Home_Page SHALL show an "Upcoming reminders" card listing pending Reminders of the Active_Profile in due order with their local time in a monospaced font and a Cancel control that marks the Reminder "cancelled", plus a hint that reminders ring only while the Companion_App is open in a browser tab.
9. Reminders SHALL be stored in a `reminders` store added by schema version 2 and SHALL be excluded from Backup_Documents; deleting or resetting a Profile SHALL delete its Reminders, and deleting a Chat SHALL clear the chatId of Reminders created from it.
