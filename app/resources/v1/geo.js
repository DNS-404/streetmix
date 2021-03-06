require('../../../lib/db.js')
const Street = require('../../models/street.js')
const logger = require('../../../lib/logger.js')()

exports.get = async function (req, res) {
  let results

  try {
    results = await Street.find({ 'data.street.location': { $ne: null }, status: 'ACTIVE' })
  } catch (err) {
    logger.error(err)
    res.status(500).send('Could not find streets with locations.')
    return
  }

  if (!results) {
    res.status(404).send('Could not find streets with locations.')
    return
  }

  const features = results.map((result) => {
    const { location } = result.data.street
    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [location.latlng[1], location.latlng[0]]
      },
      properties: result
    }
  })

  const geojson = {
    type: 'FeatureCollection',
    features
  }

  res.status(200).json(geojson)
}
