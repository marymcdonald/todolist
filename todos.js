const express = require("express");
const morgan = require("morgan");
const flash = require("express-flash");
const session = require("express-session");
const { body, validationResult } = require("express-validator");
const store = require("connect-loki");
const PgPersistence = require("./lib/pg-persistence");
const catchError = require("./lib/catch-error");

const app = express();
const host = "localhost";
const port = 3000;
const LokiStore = store(session);

app.set("views", "./views");
app.set("view engine", "pug");

app.use(morgan("common"));
app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  cookie: {
    httpOnly: true,
    maxAge: 31 * 24 * 60 * 60 * 1000, // 31 days in millseconds
    path: "/",
    secure: false,
  },
  name: "launch-school-todos-session-id",
  resave: false,
  saveUninitialized: true,
  secret: "this is not very secure",
  store: new LokiStore({}),
}));

app.use(flash());

//Create a new datastore
app.use((req, res, next) => {
  res.locals.username = req.session.username,
  res.locals.signedIn = req.session.username,
  res.locals.store = new PgPersistence(req.session);
  next();
});

// Extract session info
app.use((req, res, next) => {
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
});

// Detect unauthorized access to routes
const requiresAuthentication = (req, res, next) => {
  if (!res.locals.signedIn) {
    res.redirect(302, "/users/signin");
  } else {
    next();
  }
};

// Redirect start page
app.get("/", (req, res) => {   
  res.redirect("/lists");
});

// Render the list of todo lists
app.get("/lists", 
  requiresAuthentication,
  catchError (async (req, res) => {
    let store = res.locals.store;
    let todoLists = await store.sortedTodoLists();

    let todosInfo = todoLists.map(todoList => ({
      countAllTodos: todoList.todos.length,
      countDoneTodos: todoList.todos.filter(todo => todo.done).length,
      isDone: store.isDoneTodoList(todoList),
    }));

    res.render("lists", {
      todoLists,
      todosInfo,
      username: res.locals.username,
      signedIn: res.locals.signedIn,
    });
  })
);

// Render new todo list page
app.get("/lists/new", requiresAuthentication, (req, res) => {
  res.render("new-list");
});

// Create a new todo list
app.post("/lists",
  requiresAuthentication,
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters.")
  ],

  catchError ( async(req, res) => {
    let store = res.locals.store;
    let todoListTitle = req.body.todoListTitle;

    const rerenderEditList = () => {
        res.render("new-list", {
          flash: req.flash(),
          todoListTitle: todoListTitle,
        });
    };

    let errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach(message => req.flash("error", message.msg));
      rerenderEditList();
    } else if (await store.existsTodoListTitle(todoListTitle)) {
      req.flash("error", "The list title must be unique.");
      rerenderEditList();
    } else {
      let created = await store.createTodoList(todoListTitle);
      if (!created) throw new Error("Failed to create Todo list");

      req.flash("success", "The todo list has been created.");
      res.redirect("/lists");
    }
  })
);


// Render individual todo list and its todos
app.get("/lists/:todoListId", 
  requiresAuthentication,
  catchError (async (req, res) => {
    let store = res.locals.store;
    let todoListId = req.params.todoListId;
    let todoList = await store.loadTodoList(+todoListId);
  
    if (todoList === undefined) throw new Error("Not found.");

    todoList.todos = await store.sortedTodos(todoList);

    res.render("list", {
      todoList,
      isDoneTodoList: store.isDoneTodoList(todoList),
      hasUndoneTodos: store.hasUndoneTodos(todoList),
    });
  })
);

// Toggle completion status of a todo
app.post("/lists/:todoListId/todos/:todoId/toggle",
  requiresAuthentication,
  catchError(async (req, res) => {
    let { todoListId, todoId } = { ...req.params };
    let store = res.locals.store;
    let toggled = await store.toggleDoneTodo(+todoListId, +todoId);
    if (!toggled) throw new Error("Not found.");

    let todo = await store.loadTodo(+todoListId, +todoId);
    if (todo.done) {
      req.flash("success", `"${todo.title}" marked as done!`);
    } else {
      req.flash("success", `"${todo.title}" marked NOT done.`);
    }

    res.redirect(`/lists/${todoListId}`);
  })
);

// Delete a todo
app.post("/lists/:todoListId/todos/:todoId/destroy", 
  requiresAuthentication,
  catchError( async (req, res) => {
    let { todoListId, todoId } = { ...req.params };
    let deleted = await res.locals.store.removeTodo(+todoListId, +todoId);

    if (!deleted) throw new Error("Not found.");

    req.flash("success", "The todo has been deleted.");
    res.redirect(`/lists/${todoListId}`);
  })
);

// Mark all todos as done
app.post("/lists/:todoListId/complete_all",
  requiresAuthentication,
  catchError (async (req, res) => {
    let todoListId = req.params.todoListId;
    let completed = await res.locals.store.completeAllTodos(+todoListId);

    if (!completed) throw new Error("Not found.");
    req.flash("success", "All todos have been marked as done.");
    res.redirect(`/lists/${todoListId}`);
  })
);

// Create a new todo and add it to the specified list
app.post("/lists/:todoListId/todos",
  requiresAuthentication,
  [
    body("todoTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The todo title is required.")
      .isLength({ max: 100 })
      .withMessage("Todo title must be between 1 and 100 characters."),
  ],
  catchError( async(req, res) => {
    let todoListId = req.params.todoListId;
    let todoList = await res.locals.store.loadTodoList(+todoListId);
    if (!todoList) throw new Error("Not found.");

      let errors = validationResult(req);
      if (!errors.isEmpty()) {
        errors.array().forEach(message => req.flash("error", message.msg));
        res.render("list", {
          flash: req.flash(),
          todoList: await res.locals.store.sortedTodos(todoList),
          todoTitle: req.body.todoTitle,
        });
      } else {
        let created = await res.locals.store.addTodo(+todoListId, req.body.todoTitle);
        if (!created) throw new Error("Not found.");

        req.flash("success", "The todo has been created.");
        res.redirect(`/lists/${todoListId}`);
      }
  })
);

// Render edit todo list form
app.get("/lists/:todoListId/edit",
  requiresAuthentication,
  catchError( async (req, res) => {
    let todoListId = req.params.todoListId;
    let todoList = await res.locals.store.loadTodoList(+todoListId);
    if (!todoList) throw new Error("Not found.");

    res.render("edit-list", { todoList });
  })
);

// Delete todo list
app.post("/lists/:todoListId/destroy",
  requiresAuthentication,
  catchError( async(req, res, next) => {
    let todoListId = +req.params.todoListId;
    let deleted = await res.locals.store.deleteTodoList(todoListId);

    if (!deleted) throw new Error("Not found.");

    req.flash("success", "Todo list deleted.");
    res.redirect("/lists");
  })
);

// Edit todo list title
app.post("/lists/:todoListId/edit",
  requiresAuthentication,
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters.")
  ],
  catchError ( async(req, res) => {
    let store = res.locals.store;
    let todoListId = req.params.todoListId;
    let todoListTitle = req.body.todoListTitle;

    const rerenderEditList = async () => {
      let todoList = await store.loadTodoList(+todoListId);
      if (!todoList) throw new Error("Not found.");

      res.render("edit-list", {
        flash: req.flash(),
        todoListTitle: todoListTitle,
        todoList: todoList,
      });
    };

    try{
      let errors = validationResult(req);
      if (!errors.isEmpty()) {
        errors.array().forEach(message => req.flash("error", message.msg));
        await rerenderEditList();
      } else if ( await store.existsTodoListTitle(todoListTitle)) {
        req.flash("error", "The list title must be unique");
        await rerenderEditList();
      } else {
        let updated = await res.locals.store.setTodoListTitle(+todoListId, todoListTitle);
        if (!updated) throw new Error('Not found.');
  
        req.flash("success", "Todo list updated.");
        res.redirect(`/lists/${todoListId}`);
      }
    } catch (error) {
      if (store.isUniqueConstraintViolation(error)) {
        req.flash("error", "The list title must be unique.");
        await rerenderEditList();
      } else {
        throw error;
      }
    }
  })
);

//Signin page
app.get("/users/signin", (req, res) => {
  req.flash("info", "Please sign in.");
  res.render("signin", {
    flash: req.flash(),
  });
});

// Handle Sign In form submission
app.post("/users/signin", 
  catchError (async (req, res) => {
    let username = req.body.username.trim();
    let password = req.body.password;
    let authenticated = await res.locals.store.authenticate(username, password);
    
    if(!authenticated) {
      req.flash("error", "Invalid credentials.");
      res.render("signin", {
        flash: req.flash(),
        username: req.body.username,
      });
    } else {
      req.session.username = username;
      req.session.signedIn = true;
      req.flash("info", "Welcome!");
      res.redirect("/lists");
    }

  })
);

// Handle Sign Out
app.post("/users/signout", (req, res) => {
  delete req.session.username;
  delete req.session.signedIn;
  res.redirect("/users/signin");
});

// Error handler
app.use((err, req, res, _next) => {
  console.log(err); // Writes more extensive information to the console log
  res.status(404).send(err.message);
});

// Listener
app.listen(port, host, () => {
  console.log(`Todos is listening on port ${port} of ${host}!`);
});