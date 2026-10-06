# Globe geography

`land-dots.json` contains longitude/latitude pairs sampled from the public-domain
[Natural Earth 1:110m land polygons](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson).
The data is bundled locally; displaying or rotating the globe requires no map API.

Samples use 1.4-degree latitude spacing and longitude spacing adjusted by the
cosine of latitude. Points inside polygon holes are excluded. Coordinates are
rounded to three decimal places. This is illustrative geography, not a boundary
or location-verification dataset.
