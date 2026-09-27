import "./App.css";

function App() {
  return (
    <div className="app">

      {/* Navbar */}
      <nav className="navbar">
        <div className="logo">
          <span className="logo-icon">🗣️</span>
          <span>BoloBuddy</span>
        </div>

        <div className="nav-links">
          <a>Home</a>
          <a>Stories</a>
          <a>Progress</a>
        </div>

        <button className="profile-btn">👤</button>
      </nav>

      {/* Hero Section */}
      <main className="home">

        <section className="hero">

          <div className="hero-content">
            <p className="welcome">✨ Welcome to BoloBuddy</p>

            <h1>
              Read.
              <br />
              Speak.
              <br />
              <span>Grow.</span>
            </h1>

            <p className="hero-description">
              Improve your English reading and speaking skills
              by reading fun stories with your AI reading buddy.
            </p>

            <button className="start-btn">
              Start Reading <span>→</span>
            </button>

            <div className="stats">
              <div>
                <strong>0</strong>
                <small>Stories Read</small>
              </div>

              <div>
                <strong>0</strong>
                <small>Day Streak</small>
              </div>

              <div>
                <strong>0%</strong>
                <small>Avg. Score</small>
              </div>
            </div>
          </div>

          {/* Reading Card */}
          <div className="reading-card">

            <div className="card-top">
              <span>📖 Today's Story</span>
              <span className="easy">Easy</span>
            </div>

            <div className="illustration">
              🦊
            </div>

            <h2>The Little Fox</h2>

            <p>
              A little fox went into the forest
              looking for a new adventure...
            </p>

            <div className="card-info">
              <span>⏱ 3 min</span>
              <span>⭐ Beginner</span>
            </div>

            <button className="read-btn">
              Read Story →
            </button>

          </div>

        </section>

      </main>

    </div>
  );
}

export default App;