import $ from 'jquery';
import geomap from 'jquery.geo';
import WebGLHeatmap from 'webgl-heatmap';

let map = null,
    checkedIds = [], //< list of tweet ids we've checked
    appendedCount = 0, //< number of tweets we successfully appended
    searchTerm = "", //< last search term
    searching = false,
    currentXhr = null, //< an ajax request reference if we need to cancel
    
    timeoutRefresh = null,
    canvas = document.createElement( 'canvas' ),
    heatmap = null;

try {
  // heatmap test
  heatmap = new WebGLHeatmap( {
    canvas: canvas,
    width: 1,
    height: 1
  } );
} catch ( err ) {
  console.log( err );
  heatmap = null;
}

function heatmapService() {
  return heatmap ? {
      type: 'shingled',
      "class": 'heatmap-service',
      style: {
        opacity: .98
      },
      src: function( view ) {
        if ( heatmap ) {
          canvas.width = 0;
          canvas.height = 0;
          var data = $( '.heatmap-service' ).geomap( 'find', '*' );

          if ( !map || !heatmap || data.length === 0 ) {
            return canvas.toDataURL( 'image/png' );
          }

          // since the pixel points can change at any time,
          // we need to keep recreating the heatmap and adding
          // re-calculated pixel points
          heatmap = new WebGLHeatmap( {
            canvas: canvas,
            width: view.width,
            height: view.height
          } );

          for ( var i = 0, pixelPos; i < data.length; i++ ) {
            pixelPos = map.geomap( 'toPixel', data[ i ].geometry.coordinates );
            heatmap.addPoint( pixelPos[ 0 ], pixelPos[ 1 ], 64, 1 );
          }

          heatmap.update();
          heatmap.display();
          return canvas.toDataURL( 'image/png' );
        }
      }
    } : {
      type: 'shingled',
      "class": 'heatmap-service',
      src: ''
    };
}

function initMap(center, zoom) {
  // create a map using an optional center and zoom
  // we're re-adding the default basemap because we're adding extra services on top of it
  var services = [
    {
      type: "tiled",
      src: function (view) {
        return "//" + String.fromCharCode(97 + (view.index % 3)) + ".tile.openstreetmap.org/" + view.zoom + "/" + view.tile.column + "/" + view.tile.row + ".png";
      },
      attr: '&copy; <a href="http://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'

    },
    heatmapService()
  ];

  map = $("#map").geomap({
    center: center || [-71.0597732, 42.3584308],
    zoom: zoom || 10,
    zoomMin: 5,
    zoomMax: 16,

    services: services,

    mode: 'click',

    move: function (e, geo) {
      // when the user moves, search for appended tweets
      // and show a popup

      // clear the popup
      $("#popup").hide().html("");

      if (searchTerm) {
        // spatial query, geo has the cursor location as a map point
        // this will find appended tweets within 3 pixels
        var features = $( '.heatmap-service' ).geomap("find", geo, 16),
            popupHtml = "",
            i = 0;

        // for each tweet found, add some html to the popup
        for (; i < features.length; i++) {
          popupHtml += "<p>" + features[i].properties.tweet + "</p>";
        }

        if (popupHtml) {
          // if any tweets found, show the popup
          var $popup = $("#popup").append(popupHtml).css({
            left: e.pageX,
            top: e.pageY
          });
          
          // try to reposition the popup inside the browser if it's too big
          var widthOver = $(window).width() - ( $popup.width() + e.pageX ),
              heightOver = ($(window).height() - 32) - ( $popup.height() + e.pageY ),
              left = e.pageX,
              top = e.pageY;

          if ( widthOver < 0 ) {
            left += widthOver;
          }

          if ( heightOver < 0 ) {
            top += heightOver;
          }

          $popup.css({
            left: left,
            top: top
          }).show();
        }
      }
    },

    /*
    bboxchange: function( e, geo ) {
      var state = $.bbq.getState( );
      var center = map.geomap( 'option', 'center' );

      $.extend( state, {
        lon: center[ 0 ].toFixed( 3 ),
        lat: center[ 1 ].toFixed( 3 ),
        zoom: map.geomap( 'option', 'zoom' )
      } );

      $.bbq.pushState( state );
    }
    */
  });

  $( '.heatmap-service' ).geomap( 'option', 'shapeStyle', { width: 0, height: 0 } );

  if ( searchTerm && !searching ) {
    // kick off an autoSearch if we have a search term
    autoSearch();
  }
}

$("#loc").submit(function (e) {
  e.preventDefault();

  $("#ajaxIndicator").css("visibility", "visible");
  var q = $("#loc input").val();

  // when the user clicks the location search button,
  // send a request to nominatim for an OpenStreatMap data search
  $.ajax({
    url: "http://nominatim.openstreetmap.org/search",
    data: {
      format: "json",
      q: q
    },
    dataType: "jsonp",
    jsonp: "json_callback",
    complete: function( ) {
      $("#ajaxIndicator").css("visibility", "hidden");
    },
    success: function (results) {            
      if (results && results.length > 0) {
        /*
        var state = $.bbq.getState();

        $.extend( state, {
          lon: parseFloat( results[0].lon ).toFixed( 3 ),
          lat: parseFloat( results[0].lat ).toFixed( 3 ),
          zoom: map.geomap( 'option', 'zoom' ),
          l: encodeURIComponent( q )
        } );

        $.bbq.pushState( state );
        */

        map.geomap( 'option', 'center', [ parseFloat( results[0].lon ).toFixed( 3 ), parseFloat( results[0].lat ).toFixed( 3 ) ] );

        if ( searchTerm ) {
          if (currentXhr) {
            // if there's a search pending, cancel it
            currentXhr.abort();
            currentXhr = null;
          }

          $("#popup").hide().html("");

          autoSearch();
        }
      } else {
        console.log( 'location search returned no results' );
      }
    }
  });
  return false;
});


$("#twit").submit(function (e) {
  e.preventDefault();

  var newSearchTerm = $("#twit input").val();
  if ( newSearchTerm !== searchTerm ) {
    // when the user clicks the tweet search button,
    // start sending requests to twitter

    if (currentXhr) {
      // if there's a search pending, cancel it
      currentXhr.abort();
      currentXhr = null;
    }

    $("#popup").hide().html("");

    // save our search term
    searchTerm = newSearchTerm;

    // clear old search term data
    $( '.heatmap-service' ).geomap( 'empty' );
    appendedCount = 0;
    $("#appendedCount").text( 'no tweets mapped yet :(' );

    if ( searchTerm ) {
      /*
      var state = $.bbq.getState();
      state.q = encodeURIComponent( searchTerm );
      $.bbq.pushState( state );
      */
      autoSearch();
    }
  }

  return false;
});

function search() {
  // called by autoSearch, this function actually searches Twitter for geo-enabled tweets

  if ( map !== null ) {
    var center = map.geomap("option", "center"), //< the center of the map in lon, lat
        // the geocode argument to Twitter search,
        // it's an array with [ lat, lon, radius in km ]
        // geomap's center is lon, lat so we have to switch
        // for radius we'll use document width * pixelSize converted to km (from meters)
        // Twitter search has a max of 2500km
        geocode = [ 
          center[1],
          center[0],
          Math.min(2500, map.geomap("option", "pixelSize") * $(document).width() / 2 / 1000) + "km"
        ],
        lastSearchTerm = searchTerm;

    $("#ajaxIndicator").css("visibility", "visible");

    if (window.location.host.match(/localhost/)) {
      setTimeout( function() {
        appendTweet(genTweet());
        appendTweet(genTweet());
        $("#ajaxIndicator").css("visibility", "hidden");
      }, 500 );
    } else {
      // actually send the request to Twitter
      currentXhr = $.ajax({
        url: "search.php",
        data: {
          rpp: 100,
          q: lastSearchTerm,
          geocode: geocode.join(",")
        },
        dataType: "json",
        complete: function (result) {
          currentXhr = null;
          $("#ajaxIndicator").css("visibility", "hidden");
        },
        success: function (tweets) {
          if (searchTerm == lastSearchTerm && tweets.statuses) {
            // if we have results, search each of them for the coordinates or place property
            $.each(tweets.statuses, function () {
              appendTweet(this);
            });
          }
        },
        error: function ( err ) {
          // oops, Twitter search failed
        }
      });

    }
  }
}

function appendTweet( tweet ) {
  // attempt to append a tweet if we haven't already
  if ( $.inArray( tweet.id_str, checkedIds ) >= 0 ) {
    return;
  }

  // we don't want to attempt more than once for a given tweet
  checkedIds.push( tweet.id_str );

  // store some tweet html as a property on the feature
  var feature = {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [ 0, 0 ]
    },
    properties: {
      tweet: "<b>" + tweet.user.screen_name + "</b>: " + tweet.text
    }
  };

  if (tweet.coordinates) {
    // if we have a coordinates property, we can add this tweet to the map
    // in proper GeoJSON spec order
    // Twitter uses [lat, lon] instead of [lon, lat]
    feature.geometry = tweet.coordinates;

    appendTweetShape( feature );
  } else if ( tweet.place && tweet.place.bounding_box ) {
    // otherwise, get the center of the the place's
    // their bounding_box property is actually a polygon
    var placeCenter = $.geo.centroid( tweet.place.bounding_box );

    feature.geometry.coordinates = placeCenter;
    appendTweetShape( feature );
  }
}

function appendTweetShape( feature ) {
  // called for every tweet
  // pick the appropriate hue service based on number of tweets around
  // and add this tweet to EACH hue service up to that point
  // this will add a bunch of bubbles per tweet as more tweets are found
  if ( timeoutRefresh ) {
    clearTimeout( timeoutRefresh );
    timeoutRefresh = null;
  }

  // even though we may have appended four shapes for a medium hotness
  // tweet, we have only processed one actual tweet, update appendedCount & UI
  appendedCount++;
  $("#appendedCount").text(appendedCount + " tweets mapped!");

  $('.heatmap-service' ).geomap( 'append', feature, false );

  timeoutRefresh = setTimeout( function( ) {
    timeoutRefresh = null;
    $('.heatmap-service' ).geomap( 'refresh' );
  }, 33 );
}

function autoSearch() {
  searching = true;
  if ( searchTerm ) {
    search();
    setTimeout(autoSearch, 10000);
  }
}




if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(function (p) {
    initMap([p.coords.longitude, p.coords.latitude]);
  }, function (error) {
    initMap();
  });
} else {
  // if all else fails, use defaults
  initMap();
}

function genTweet() {
  var baconIpsum = [ 'bacon', 'ipsum', 'dolor', 'sit', 'amet', 'panchetta', 'meatball', 'labore', 'in aute', 'chop' ];
  function meat(count) {
    count = count || 1;
    var meatyReturn = '';
    for ( var i = 0; i < count; i++ ) {
      if ( i > 0 ) {
        meatyReturn += ' ';
      }
      meatyReturn += baconIpsum[Math.floor(Math.random()*10)];
    }
    return meatyReturn;
  }

  var time = $.now();
  var name = meat();
  var c = map.geomap('option', 'center');
  var xoff = Math.random() > 0.5 ? 1 : -1;
  var yoff = Math.random() > 0.5 ? 1 : -1;

  return {
    created_at: 'Mon May 26 01:54:09 +0000 2014',
    id: time,
    id_str: '' + time,
    text: meat(4),
    source: '<a href="http://twitter.com/download/iphone" rel="nofollow">Twitter for iPhone</a>',
    user: {
      name: name,
      screen_name: name,
      location: meat(),
      description: meat(4),
      geo_enabled: true,
      lang: 'en',
      profile_image_url: 'https://pbs.twimg.com/profile_images/465542577324707840/g_YuiWA5_400x400.png',
    },
    geo: {
      type: 'Point',
      coordinates: [ c[1], c[0] ]
    },
    coordinates: {
      type: 'Point',
      coordinates: [ c[0] + xoff * Math.random()/4, c[1] + yoff * Math.random()/4 ]
    },
    place: {
      id: '' + time,
      place_type: 'admin',
      name: 'Here',
      full_name: 'Here',
      country_code: 'US',
      country: 'United States',
      bounding_box: $.geo.polygonize( map.geomap('option', 'bbox' ) ) //< note: Twitter's Polygon isn't closed/valid
    },
    lang: 'en'
  }
}
