import "./Stories.css";

function Stories() {
  return (
    <div className="stories-page">

      <div className="stories-header">
        <div>
          <p className="stories-label">📚 Explore & Learn</p>
          <h1>Choose a Story</h1>
          <p>
            Pick a story you like and start reading aloud.
          </p>
        </div>

        <div className="story-search">
          🔍 <input placeholder="Search stories..." />
        </div>
      </div>

      <div className="category-tabs">
        <button className="active">All Stories</button>
        <button>Beginner</button>
        <button>Intermediate</button>
        <button>Advanced</button>
      </div>

      <div className="stories-grid">

        <div className="story-card">
          <div className="story-image fox">🦊</div>

          <div className="story-content">
            <span className="difficulty easy">Easy</span>

            <h2>The Little Fox</h2>

            <p>
              A little fox goes into the forest
              looking for a new adventure.
            </p>

            <div className="story-details">
              <span>⏱ 3 min</span>
              <span>⭐ Beginner</span>
            </div>

            <button className="story-btn">
              Read Story →
            </button>
          </div>
        </div>


        <div className="story-card">
          <div className="story-image rabbit">🐰</div>

          <div className="story-content">
            <span className="difficulty easy">Easy</span>

            <h2>The Clever Rabbit</h2>

            <p>
              A clever rabbit finds a smart way
              to solve a difficult problem.
            </p>

            <div className="story-details">
              <span>⏱ 4 min</span>
              <span>⭐ Beginner</span>
            </div>

            <button className="story-btn">
              Read Story →
            </button>
          </div>
        </div>


        <div className="story-card">
          <div className="story-image space">🚀</div>

          <div className="story-content">
            <span className="difficulty medium">Medium</span>

            <h2>A Trip to Space</h2>

            <p>
              Imagine travelling through space
              and discovering a new planet.
            </p>

            <div className="story-details">
              <span>⏱ 5 min</span>
              <span>⭐ Intermediate</span>
            </div>

            <button className="story-btn">
              Read Story →
            </button>
          </div>
        </div>


        <div className="story-card">
          <div className="story-image ocean">🐳</div>

          <div className="story-content">
            <span className="difficulty medium">Medium</span>

            <h2>Under the Ocean</h2>

            <p>
              Dive deep into the ocean and meet
              amazing underwater creatures.
            </p>

            <div className="story-details">
              <span>⏱ 5 min</span>
              <span>⭐ Intermediate</span>
            </div>

            <button className="story-btn">
              Read Story →
            </button>
          </div>
        </div>

      </div>

    </div>
  );
}

export default Stories;