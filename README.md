# Любовный Настроение

Build a real-time audience sentiment tracking web application using React, Tailwind CSS, and Supabase Realtime. 

IMPORTANT: All UI text, buttons, and labels MUST be in Russian. The internal logic and code can be in English.

APP ARCHITECTURE & ROLES:
The app has two main flows: the Room Creator (Dashboard) and the Participant (Voter). We do not need persistent database storage for the votes; please use Supabase Realtime (Broadcast and Presence channels) to sync state instantly in-memory.

1. HOME PAGE (/)
- A simple clean landing page with a single large button: "Создать комнату".
- Clicking it generates a unique random Room ID and redirects the user to the Creator Dashboard.

2. CREATOR DASHBOARD (/dashboard/:roomId)
- Top-Left Corner: A generated QR Code (use qrcode.react or similar) that links to the Participant View URL (e.g., https://[app-domain]/vote/:roomId).
- Top-Right Corner: Text displaying "Количество участников: {count}". Use Supabase Presence to track live connected users.
- Main Content: A single large vertical column/bar chart representing the live audience mood. It moves up and down dynamically.
- Aggregation Logic: The dashboard receives the current slider value from all connected participants in real-time. The bar displays the SUM of all current participant values. (e.g., if 3 users are at +100, the total is +300). The visual Y-axis max/min should scale dynamically based on the participant count (max = participants * 100, min = participants * -100).
- Lifecycle: When the creator leaves the page or closes the tab, the room is effectively destroyed (no data persistence needed).

3. PARTICIPANT VIEW (/vote/:roomId)
- Mobile-first design.
- UI: A large vertical slider taking up the center of the screen.
- Slider Scale: Center default position is 0. Extreme top is +100. Extreme bottom is -100.
- Top Label: "Мне очень нравится"
- Bottom Label: "Мне очень не нравится"
- Physics & Mechanics: The user can drag and hold the thumb anywhere. When the user RELEASES the slider (onPointerUp/onTouchEnd), the slider must automatically and smoothly slide back to 0 over exactly 5 seconds. (You can implement this using requestAnimationFrame or smooth CSS transitions updated via React state).
- Data transmission: While the slider is being moved AND while it is automatically returning to 0, its current value must be broadcasted to the Creator Dashboard in real-time with minimal latency. 

TECHNICAL CONSTRAINTS (MVP):
- No anti-fraud or login required.
- Focus on low-latency updates using Supabase Broadcast.
- Ensure the slider return animation feels smooth and linear over the 5 seconds.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://skbt-fights.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0f449e4f-645a-4293-ad9d-38ea61f6a79b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
