$(function () {
  var map = null,
      checkedIds = [], //< list of tweet ids we've checked
      appendedCount = 0, //< number of tweets we successfully appended
      searchTerm = "", //< last search term
      searching = false,
      currentXhr = null, //< an ajax request reference if we need to cancel
      
      twitterButtonHtml = '<a href="https://twitter.com/share" class="twitter-share-button" data-count="vertical" data-via="ryanttb">Tweet</a><script src="//platform.twitter.com/widgets.js">\x3C/script>'
      timeoutRefresh = null,
      canvas = document.createElement( 'canvas' ),
      heatmap = null,
      data = [];

  try {
    // heatmap test
    heatmap = createWebGLHeatmap( {
      canvas: canvas,
      width: 1,
      height: 1
    } );
  } catch ( err ) {
    console.log( err );
    heatmap = null;
  }

  function initMap(center, zoom) {
    // create a map using an optional center and zoom
    // we're re-adding the default basemap because we're adding extra services on top of it
    var services = [
          {
            type: "tiled",
            src: function( view ) {
                return "http://otile" + ((view.index % 4) + 1) + ".mqcdn.com/tiles/1.0.0/osm/" + view.zoom + "/" + view.tile.column + "/" + view.tile.row + ".png";
            },
            attr: "<p>Tiles Courtesy of <a href='http://www.mapquest.com/' target='_blank'>MapQuest</a> <img src='http://developer.mapquest.com/content/osm/mq_logo.png'></p>"
          },
          {
            type: 'shingled',
            class: 'heatmap-service',
            style: {
              opacity: .98
            },
            src: function( view ) {
              canvas.width = 0;
              canvas.height = 0;

              if ( !map || !heatmap || data.length === 0 ) {
                return canvas.toDataURL( 'image/png' );
              }

              // since the pixel points can change at any time,
              // we need to keep recreating the heatmap and adding
              // re-calculated pixel points
              heatmap = createWebGLHeatmap( {
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
        ];
      
    map = $("#map").geomap({
      center: center || [-71.0597732, 42.3584308],
      zoom: zoom || 10,
      zoomMin: 5,
      zoomMax: 16,

      services: services,

      mode: "point",
      scroll: "off",
      cursors: {
        point: "default"
      },

      dblclick: function( e, geo ) { 
        // prevent the default dblclick zoom behavior,
        // we want to change the URL so it can be tweeted
        e.preventDefault( );

        var zoom = map.geomap( "option", "zoom" );
        if ( zoom < 16 ) {
          window.location.search = 
            "q=" + encodeURIComponent($("#twit input").val()) +
            "&l=" + encodeURIComponent($("#loc input").val()) +
            "&center=" + $.geo.proj.toGeodetic( geo.coordinates ) +
            "&zoom=" + ( map.geomap( "option", "zoom" ) + 1 );
        }
      },

      // set the shapeStyle to a largish solid but translucent circle
      // to give the tweets a heat map effect
      shapeStyle: {
        //strokeOpacity: 0,
        fillOpacity: 1
        //width: "16px",
        //height: "16px",
        //borderRadius: "16px",
        //color: "#e44"
      },

      move: function (e, geo) {
        // when the user moves, search for appended tweets
        // and show a popup

        // clear the popup
        $("#popup").hide().html("");

        if (searchTerm) {
          // spatial query, geo has the cursor location as a map point
          // this will find appended tweets within 3 pixels
          var features = $( "#h240" ).geomap("find", geo, 31),
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
      }
    });

    // set the zoom input the map's zoom
    //$( "#zoom input" ).val( map.geomap( "option", "zoom" ) ).css( "visibility", "visible" );

    if ( searchTerm && !searching ) {
      // kick off an autoSearch if we have a search term
      autoSearch();
    }
  }

  $("#loc").submit(function (e) {
    e.preventDefault();

    $("#ajaxIndicator").css("visibility", "visible");

    // when the user clicks the location search button,
    // send a request to nominatim for an OpenStreatMap data search
    $.ajax({
      url: "http://open.mapquestapi.com/nominatim/v1/search",
      data: {
        format: "json",
        q: $("#loc input").val()
      },
      dataType: "jsonp",
      jsonp: "json_callback",
      complete: function( ) {
        $("#ajaxIndicator").css("visibility", "hidden");
      },
      success: function (results) {            
        if (results && results.length > 0) {
          // if we get a result, relaunch the app to the new location with the old search
          // this will allow users to tweet their map
          window.location.search = 
            "q=" + encodeURIComponent($("#twit input").val()) +
            "&l=" + encodeURIComponent($("#loc input").val()) +
            "&center=" + results[0].lon + "," + results[0].lat +
            "&zoom=" + ( map.geomap("option", "zoom") );
        }
      }
    });
    return false;
  });

  $( "#zoomout" ).click( function( e ) {
    //$( "#zoom input" ).css( "visibility", "hidden" );
    var zoom = map.geomap( "option", "zoom" );
    if ( zoom > 5 ) {
      window.location.search = 
        "q=" + encodeURIComponent($("#twit input").val()) +
        "&l=" + encodeURIComponent($("#loc input").val()) +
        "&center=" + map.geomap( "option", "center" ) +
        "&zoom=" + ( map.geomap( "option", "zoom" ) - 1 );
    }
  } );

  $( "#zoomin" ).click( function( e ) {
    //$( "#zoom input" ).css( "visibility", "hidden" );
    var zoom = map.geomap( "option", "zoom" );
    if ( zoom  < 16 ) {
      window.location.search = 
        "q=" + encodeURIComponent($("#twit input").val()) +
        "&l=" + encodeURIComponent($("#loc input").val()) +
        "&center=" + map.geomap( "option", "center" ) +
        "&zoom=" + ( map.geomap( "option", "zoom" ) + 1 );
    }
  } );

  $("#twit").submit(function (e) {
    e.preventDefault();

    // when the user clicks the tweet search button,
    // send a request to twitter

    if (currentXhr) {
      // if there's a search pending, cancel it
      currentXhr.abort();
      currentXhr = null;
    }

    $("#popup").hide().html("");

    // save our search term
    searchTerm = $("#twit input").val();

    if ( searchTerm ) {
      // if we have a new search term, relaunch the app to the same location with the new search
      // this will allow users to tweet their map
      window.location.search = 
        "q=" + encodeURIComponent(searchTerm) +
        "&l=" + encodeURIComponent($("#loc input").val()) +
        "&center=" + map.geomap("option", "center").toString() +
        "&zoom=" + ( map.geomap("option", "zoom") );
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

    data.push( feature );

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

  // for fun, we support sending center, zoom and a tweet query in the query string
  var queryString = window.location.search.substring(1),
      params = queryString.split("&"),
      options = {};

  $.each(params, function() {
    var idx = this.indexOf("=");
    if (idx > 0) {
      options[this.substring(0, idx)] = this.substring(idx + 1);
    }
  });

  if (options.center) {
    if (options.zoom) {          
      initMap($.parseJSON("[" + options.center + "]"), parseInt(options.zoom));
    } else {
      initMap($.parseJSON("[" + options.center + "]"));
    }
  } else {
    // if there's no center in the query string, try to use geolocation
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
  }

  var title = "Twheat !";

  if (options.q) {
    searchTerm = decodeURIComponent(options.q);
    $("#twit input").val(searchTerm);
    title += " " + searchTerm;

    if ( map !== null && !searching ) {
      autoSearch();
    }
  }

  if (options.l) {
    var loc = decodeURIComponent(options.l);
    $("#loc input").val(loc);
    title += " " + loc;
  }

  $("title").html(title);
  $("#tweetButton").append(twitterButtonHtml);

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
});  

