// Run this before other modules
if (process.env.NEW_RELIC_LICENSE_KEY) {
  require('newrelic')
}

process.title = 'streetmix'

const compression = require('compression')
const cookieParser = require('cookie-parser')
const cookieSession = require('cookie-session')
const envify = require('envify/custom')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const browserify = require('browserify-middleware')
const babelify = require('babelify')
const bodyParser = require('body-parser')
const config = require('config')
const path = require('path')
const controllers = require('./app/controllers')
const resources = require('./app/resources')
const requestHandlers = require('./lib/request_handlers')
const middleware = require('./lib/middleware')
const exec = require('child_process').exec

const app = module.exports = express()

app.locals.config = config

// Not all headers from `helmet` are on by default. These turns on specific
// off-by-default headers for better security as recommended by https://securityheaders.io/
const helmetConfig = {
  frameguard: false, // Allow Streetmix to be iframed in 3rd party sites
  hsts: {
    maxAge: 5184000, // 60 days
    includeSubDomains: false // we don't have a wildcard ssl cert
  },
  referrerPolicy: {
    policy: 'no-referrer-when-downgrade'
  },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com'],
      scriptSrc: [
        "'self'",
        'platform.twitter.com',
        'https://www.google-analytics.com',
        'cdn.mxpnl.com',
        '*.basemaps.cartocdn.com',
        'api.geocode.earth',
        "'sha256-ZFVNSjbMCfXEvm7Udu+4fzj7uxtIasWHfUkYsyr9Xzc='", // Google Analytics (w/ production id)
        "'sha256-80ZBre/y2+jBIlTB4jDA8maeor/DkrMKKHcR+VALCFg='" // Mixpanel (w/ production id)
      ],
      childSrc: ['platform.twitter.com'],
      imgSrc: [
        "'self'",
        'data:',
        'pbs.twimg.com',
        'syndication.twitter.com',
        'https://www.google-analytics.com',
        '*.basemaps.cartocdn.com'
      ],
      fontSrc: ["'self'", 'fonts.gstatic.com'],
      connectSrc: ["'self'",
        'freegeoip.net',
        'api.mixpanel.com',
        'api.geocode.earth',
        'syndication.twitter.com',
        'https://www.google-analytics.com',
        'app.getsentry.com'
      ]
    }
  }
}

app.use(helmet(helmetConfig))
app.use(bodyParser.json())
app.use(compression())
app.use(cookieParser())
app.use(cookieSession({ secret: config.cookie_session_secret }))

app.use(requestHandlers.login_token_parser)
app.use(requestHandlers.request_log)
app.use(requestHandlers.request_id_echo)

// Permanently redirect http to https in production.
app.use(function (req, res, next) {
  if (app.locals.config.env === 'production') {
    // req.secure is Express's flag for a secure request, but this is not available
    // on Heroku, which uses a header instead.
    if (req.secure === true || req.headers['x-forwarded-proto'] !== 'https') {
      res.redirect(301, 'https://' + req.hostname + req.originalUrl)
    } else {
      next()
    }
  } else {
    next()
  }
})

app.set('view engine', 'hbs')
app.set('views', path.join(__dirname, '/app/views'))

// Redirect to environment-appropriate domain, if necessary
// In production, this redirects streetmix-v2.herokuapp.com to https://streetmix.net/
app.all('*', function (req, res, next) {
  if (config.header_host_port !== req.headers.host && app.locals.config.env !== 'development') {
    const redirectUrl = 'https://' + config.header_host_port + req.url
    console.log('req.hostname = %s but config.header_host_port = %s; redirecting to %s...', req.hostname, config.header_host_port, redirectUrl)
    res.redirect(301, redirectUrl)
  } else {
    next('route')
  }
})

app.get('/help/about', function (req, res) {
  res.redirect('https://www.opencollective.com/streetmix/')
})

app.get('/map', function (req, res) {
  res.redirect('https://streetmix.github.io/famous-streets/')
})

app.get('/twitter-sign-in', controllers.twitter_sign_in.get)
app.get(config.twitter.oauth_callback_uri, controllers.twitter_sign_in_callback.get)

app.post('/api/v1/users', resources.v1.users.post)
app.get('/api/v1/users/:user_id', resources.v1.users.get)
app.put('/api/v1/users/:user_id', resources.v1.users.put)
app.delete('/api/v1/users/:user_id/login-token', resources.v1.users.delete)
app.get('/api/v1/users/:user_id/streets', resources.v1.users_streets.get)

app.post('/api/v1/streets', resources.v1.streets.post)
app.get('/api/v1/streets', resources.v1.streets.find)
app.head('/api/v1/streets', resources.v1.streets.find)

app.delete('/api/v1/streets/:street_id', resources.v1.streets.delete)
app.head('/api/v1/streets/:street_id', resources.v1.streets.get)
app.get('/api/v1/streets/:street_id', resources.v1.streets.get)
app.put('/api/v1/streets/:street_id', resources.v1.streets.put)

app.get('/api/v1/geo', cors(), resources.v1.geo.get)

app.post('/api/v1/feedback', resources.v1.feedback.post)

app.get('/api/v1/translate/:locale_code/:resource_name', resources.v1.translate.get)

app.get('/.well-known/status', resources.well_known_status.get)

// Process stylesheets via Sass and PostCSS / Autoprefixer
app.use('/assets/css/styles.css', middleware.styles.get)

app.get('/assets/scripts/main.js', browserify(path.join(__dirname, '/assets/scripts/main.js'), {
  cache: true,
  precompile: true,
  extensions: [ '.jsx' ],
  transform: [babelify, envify({
    APP_HOST_PORT: config.get('app_host_port'),
    FACEBOOK_APP_ID: config.get('facebook_app_id'),
    API_URL: config.get('restapi_proxy_baseuri_rel'),
    TWITTER_CALLBACK_URI: config.get('twitter').oauth_callback_uri,
    ENV: config.get('env'),
    NO_INTERNET_MODE: config.get('no_internet_mode')
  })]
}))

// SVG bundled images served directly from packages
app.get('/assets/images/icons.svg', function (req, res) {
  res.sendFile(path.join(__dirname, '/node_modules/@streetmix/icons/dist/icons.svg'))
})

app.get('/assets/images/images.svg', function (req, res) {
  res.sendFile(path.join(__dirname, '/node_modules/@streetmix/illustrations/dist/images.svg'))
})

app.use(express.static(path.join(__dirname, '/public')))

// Catch-all
app.use(function (req, res) {
  res.render('main', {})
})

// Set up file watcher in development
if (config.env === 'development') {
  const chokidar = require('chokidar')
  const compileStyles = require('./lib/middleware/styles').compile

  // Watch SCSS files
  const cssWatcher = chokidar.watch('assets/css/*.scss')

  cssWatcher.on('change', path => {
    console.log(`File ${path} has been changed`)
    compileStyles()
  })
}

// Provide a message after a Ctrl-C
// Note: various sources tell us that this does not work on Windows
process.on('SIGINT', function () {
  if (app.locals.config.env === 'development') {
    console.log('Stopping Streetmix!')
    exec('npm stop')
  }
  process.exit()
})
