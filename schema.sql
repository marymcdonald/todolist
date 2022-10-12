CREATE TABLE users (
  username text PRIMARY KEY,
  password text NOT NULL
);

CREATE TABLE todolists(
  id serial PRIMARY KEY,
  title varchar(100) UNIQUE NOT NULL,
  username text NOT NULL REFERENCES users (username) ON DELETE CASCADE
);

CREATE TABLE todos(
  id serial PRIMARY KEY,
  title varchar(100) NOT NULL,
  done boolean NOT NULL DEFAULT false,
  todolist_id integer NOT NULL REFERENCES todolists (id) ON DELETE CASCADE,
  username text NOT NULL REFERENCES users (username) ON DELETE CASCADE
);