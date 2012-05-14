dojo.declare( 'JBrowse.View.TrackList.Faceted', null,
   /**
    * @lends JBrowse.View.TrackList.Faceted.prototype
    */
   {

   /**
     * Track selector with facets and text searching.
     * @constructs
     */
   constructor: function(args) {
       dojo.require('dojox.grid.EnhancedGrid');
       dojo.require('dojox.grid.enhanced.plugins.IndirectSelection');
       dojo.require('dijit.layout.AccordionContainer');
       dojo.require('dijit.layout.AccordionPane');

       this.browser = args.browser;
       this.tracksActive = {};

       // construct the discriminator for whether we will display a
       // facet selector for this facet
       this._isSelectableFacet = function() {
           // just a function returning true if not specified
           var filter = args.selectableFacets ||
               // default facet filtering function
               function( store, facetName ){
                   return (
                       // has an avg bucket size > 1
                       store.getFacetStats( facetName ).avgBucketSize > 1
                    &&
                       // and not an ident or label attribute
                       ! dojo.some( store.getLabelAttributes()
                                    .concat( store.getIdentityAttributes() ),
                                    function(l) {return l == facetName;}
                                  )
                   );
               };
           // if we have a non-function filter, coerce to an array,
           // then convert that array to a function
           if( typeof filter == 'string' )
               filter = [filter];
           if( Array.isArray( filter ) ) {
               filter = function( store, facetName) {
                   return dojo.some( filter, function(fn) {
                                         return facetName == fn;
                                     });
               };
           }
           return filter;
       }.call(this);

       // data store that fetches and filters our track metadata
       this.trackDataStore = args.trackMetaData;

       // subscribe to commands coming from the the controller
       dojo.subscribe( '/jbrowse/v1/c/tracks/show',
                       dojo.hitch( this, 'setTracksActive' ));
       // subscribe to commands coming from the the controller
       dojo.subscribe( '/jbrowse/v1/c/tracks/hide',
                       dojo.hitch( this, 'setTracksInactive' ));

       // once its data is loaded and ready
       dojo.connect( this.trackDataStore, 'onReady', this, function() {

           // render our controls and so forth
           this.render();

           // connect events so that when a grid row is selected or
           // deselected (with the checkbox), publish a message
           // indicating that the user wants that track turned on or
           // off
           dojo.connect( this.dataGrid.selection, 'onSelected', this, function(index) {
                         this._ifNotSuppressed( 'selectionEvents', function() {
                             this._suppress( 'gridUpdate', function() {
                                 dojo.publish( '/jbrowse/v1/v/tracks/show', [[this.dataGrid.getItem( index ).conf]] );
                             });
                         });

           });
           dojo.connect( this.dataGrid.selection, 'onDeselected', this, function(index) {
                         this._ifNotSuppressed( 'selectionEvents', function() {
                             this._suppress( 'gridUpdate', function() {
                                 dojo.publish( '/jbrowse/v1/v/tracks/hide', [[this.dataGrid.getItem( index ).conf]] );
                             });
                         });
           });
       });

       dojo.connect( this.trackDataStore, 'onFetchSuccess', this, '_updateGridSelections' );
       dojo.connect( this.trackDataStore, 'onFetchSuccess', this, '_updateMatchCount' );

    },

    /**
     * Call the given callback if none of the given event suppression flags are set.
     * @private
     */
    _ifNotSuppressed: function( suppressFlags, callback ) {
        if( typeof suppressFlags == 'string')
            suppressFlags = [suppressFlags];
        if( !this.suppress)
            this.suppress = {};
        if( dojo.some( suppressFlags, function(f) {return this.suppress[f];}, this) )
            return undefined;
        return callback.call(this);
    },

    /**
     * Call the given callback while setting the given event suppression flags.
     * @private
     */
    _suppress: function( suppressFlags, callback ) {
        if( typeof suppressFlags == 'string')
            suppressFlags = [suppressFlags];
        if( !this.suppress)
            this.suppress = {};
        dojo.forEach( suppressFlags, function(f) {this.suppress[f] = true; }, this);
        var retval = callback.call( this );
        dojo.forEach( suppressFlags, function(f) {this.suppress[f] = false;}, this);
        return retval;
    },

    /**
     * Call a method of our object such that it cannot call itself
     * by way of event cycles.
     * @private
     */
    _suppressRecursion: function( methodName ) {
        var flag   = ['method_'+methodName];
        var method = this[methodName];
        return this._ifNotSuppressed( flag, function() { this._suppress( flag, method );});
    },

    render: function() {
        this.containerElem = dojo.create( 'div', {
            id: 'faceted_tracksel',
            style: {
                left: '-95%',
                width: '95%',
                zIndex: 500
            }
        },
        document.body );

        // make the tab that turns the selector on and off
        dojo.create('div',
                    {
                        className: 'faceted_tracksel_on_off tab',
                        innerHTML: '<img src="img/left_arrow.png"><div>Select<br>tracks</div>'
                    },
                    this.containerElem
                   );


        this.mainContainer = new dijit.layout.BorderContainer(
            { design: 'headline', gutters: false },
            dojo.create('div',{ className: 'mainContainer' }, this.containerElem)
        );

        this.topPane = new dijit.layout.ContentPane(
            { region: 'top',
              id: "faceted_tracksel_top",
              content: '<div class="title">Select Tracks</div> '
                       + '<div class="topLink" style="cursor: help"><a title="Track selector help">Help</a></div>'
            });
        dojo.query('div.topLink a[title="Track selector help"]',this.topPane.domNode)
            .forEach(function(helplink){
                var helpdialog = new dijit.Dialog({
                    "class": 'help_dialog',
                    refocus: false,
                    draggable: false,
                    title: 'Track Selection',
                    content: '<div class="main">'
                             + '<p>The JBrowse Faceted Track Selector makes it easy to search through'
                             + ' large numbers of available tracks to find exactly the ones you want.'
                             + ' You can incrementally filter the track display to narrow it down to'
                             + ' those your are interested in.  There are two types of filtering available,'
                             + ' which can be used together:'
                             + ' <b>filtering with data fields</b>, and free-form <b>filtering with text</b>.'
                             + '</p>'
                             + '  <dl><dt>Filtering with Data Fields</dt>'
                             + '  <dd>The left column of the display contains the available <b>data fields</b>.  Click on the data field name to expand it, and then select one or more values for that field to narrow the search to display only tracks that have one of those values.  You can do this for any number of fields.<dd>'
                             + '  <dt>Filtering with Text</dt>'
                             + '  <dd>Type text in the "Contains text" box to filter for tracks whose data contains that text.  When you type multiple words, tracks are found that contain all of those words, in any order, and in any field.  If you place "quotation marks" around the text, the filter finds only tracks that exactly match that phrase.</dd>'
                             + '  <dt>Activating Tracks</dt>'
                             + "  <dd>To activate and deactivate a track, click its check-box in the left-most column.  When the box contains a check mark, the track is activated.  You can also turn whole groups of tracks on and off using the check-box in the table heading.</dd>"
                             + "  </dl>"
                             + "</div>"
                 });
                dojo.connect( helplink, 'onclick', this, function(evt) {helpdialog.show(); return false;});
            },this);

        this.mainContainer.addChild( this.topPane );

        // make both buttons toggle this track selector
        dojo.query( '.faceted_tracksel_on_off' )
            .onclick( dojo.hitch( this, 'toggle' ));

        // make our main components
        var textFilterContainer = this.renderTextFilter();
        var facetContainer = this.renderFacetSelectors();
        this.dataGrid = this.renderGrid();

        // put them in their places in the overall layout of the track selector
        facetContainer.set('region','left');
        this.mainContainer.addChild( facetContainer );
        var centerPane = new dijit.layout.BorderContainer({region: 'center', "class": 'gridPane', gutters: false});
        this.dataGrid.set('region','center');
        centerPane.addChild( this.dataGrid );
        centerPane.addChild(
            new dijit.layout.ContentPane(
                { region: 'top',
                  "class": 'gridControls',
                  content: [
                      dojo.create( 'button', {
                                       className: 'faceted_tracksel_on_off',
                                       innerHTML: '<img src="img/left_arrow.png"> <div>Back to browser</div>',
                                       onclick: dojo.hitch( this, 'hide' )
                                   }
                                 ),
                      dojo.create( 'button', {
                                       className: 'clear_filters',
                                       innerHTML:'<img src="img/red_x.png">'
                                                 + '<div>Clear All Filters</div>',
                                       onclick: dojo.hitch( this, function(evt) {
                                           this._clearTextFilterControl();
                                           this._clearAllFacetControls();
                                           this.updateQuery();
                                       })
                                   }
                                 ),
                      textFilterContainer,
                      dojo.create('div', { className: 'matching_record_count' })
                  ]
                }
            )
        );
        this.mainContainer.addChild( centerPane );

        this.mainContainer.startup();
        this._updateMatchCount();
    },

    renderGrid: function() {
        // make a data grid that will hold the search results
        var facets = this.trackDataStore.getFacetNames();
        var rename = { key: 'name' }; // rename some columns in the grid
        var grid = new dojox.grid.EnhancedGrid({
               id: 'trackSelectGrid',
               store: this.trackDataStore,
               noDataMessage: "No tracks match the filtering criteria.",
               structure: [
                   dojo.map( facets, function(facetName) {
                     return {'name': Util.ucFirst(rename[facetName]||facetName), 'field': facetName, 'width': '100px'};
                   })
               ],
               plugins: {
                   indirectSelection: {
                       headerSelector: true
                   }
               }
           }
        );

        this._monkeyPatchGrid( grid );
        return grid;
    },

    /**
     * Apply several run-time patches to the dojox.grid.EnhancedGrid
     * code to fix bugs and customize the behavior in ways that aren't
     * quite possible using the regular Dojo APIs.
     * @private
     */
    _monkeyPatchGrid: function( grid ) {

        // 1. monkey-patch the grid's onRowClick handler to not do
        // anything.  without this, clicking on a row selects it, and
        // deselects everything else, which is quite undesirable.
        grid.onRowClick = function() {};

        // 2. monkey-patch the grid's range-selector to refuse to select
        // if the selection is too big
        var origSelectRange = grid.selection.selectRange;
        grid.selection.selectRange = function( inFrom, inTo ) {
            var selectionLimit = 30;
            if( inTo - inFrom > selectionLimit ) {
                alert( "Too many tracks selected, please select fewer than "+selectionLimit+" tracks." );
                return undefined;
            }
            return origSelectRange.apply( this, arguments );
        };

        // 3. monkey-patch the grid's scrolling handler to fix
        // http://bugs.dojotoolkit.org/ticket/15343
        // diff between this and its implementation in dojox.grid._View.js (1.6.1) is only:
        // if(top !== this.lastTop)  --->  if( Math.abs( top - this.lastTop ) > 1 )
        grid.views.views[0].doscroll = function(inEvent){
                //var s = dojo.marginBox(this.headerContentNode.firstChild);
                var isLtr = dojo._isBodyLtr();
                if(this.firstScroll < 2){
                        if((!isLtr && this.firstScroll == 1) || (isLtr && this.firstScroll === 0)){
                                var s = dojo.marginBox(this.headerNodeContainer);
                                if(dojo.isIE){
                                        this.headerNodeContainer.style.width = s.w + this.getScrollbarWidth() + 'px';
                                }else if(dojo.isMoz){
                                        //TODO currently only for FF, not sure for safari and opera
                                        this.headerNodeContainer.style.width = s.w - this.getScrollbarWidth() + 'px';
                                        //this.headerNodeContainer.style.width = s.w + 'px';
                                        //set scroll to right in FF
                                        this.scrollboxNode.scrollLeft = isLtr ?
                                                this.scrollboxNode.clientWidth - this.scrollboxNode.scrollWidth :
                                                this.scrollboxNode.scrollWidth - this.scrollboxNode.clientWidth;
                                }
                        }
                        this.firstScroll++;
                }
                this.headerNode.scrollLeft = this.scrollboxNode.scrollLeft;
                // 'lastTop' is a semaphore to prevent feedback-loop with setScrollTop below
                var top = this.scrollboxNode.scrollTop;
                if(Math.abs( top - this.lastTop ) > 1 ){
                        this.grid.scrollTo(top);
                }
        };
    },

    renderTextFilter: function( parent ) {
        // make the text input for text filtering
        this.textFilterLabel = dojo.create(
            'label',
            { className: 'textFilterControl',
              innerHTML: 'Contains text ',
              id: 'tracklist_textfilter',
              style: {position: 'relative'}
            },
            parent
        );
        this.textFilterInput = dojo.create(
            'input',
            { type: 'text',
              size: 40,
              disabled: true, // disabled until shown
              onkeypress: dojo.hitch( this, function(evt) {
                  if( evt.keyCode == dojo.keys.SHIFT || evt.keyCode == dojo.keys.CTRL || evt.keyCode == dojo.keys.ALT )
                      return;
                  if( this.textFilterTimeout )
                      window.clearTimeout( this.textFilterTimeout );
                  this.textFilterTimeout = window.setTimeout(
                      dojo.hitch( this, function() {
                                      this._updateTextFilterControl();
                                      this.updateQuery();
                                      this.textFilterInput.focus();
                                  }),
                      500
                  );
                  this._updateTextFilterControl();

                  evt.stopPropagation();
              })
            },
            this.textFilterLabel
        );
        // make a "clear" button for the text filtering input
        this.textFilterClearButton = dojo.create('img', {
            src: 'img/red_x.png',
            className: 'text_filter_clear',
            onclick: dojo.hitch( this, function() {
                this._clearTextFilterControl();
                this.updateQuery();
            }),
            style: {
                position: 'absolute',
                right: '12px',
                top: '20%',
            }
        }, this.textFilterLabel );

        return this.textFilterLabel;
    },

   /**
    * Clear the text filter control input.
    * @private
    */
    _clearTextFilterControl: function() {
        this.textFilterInput.value = '';
        this._updateTextFilterControl();
    },
    /**
     * Update the display of the text filter control based on whether
     * it has any text in it.
     * @private
     */
    _updateTextFilterControl: function() {
        if( this.textFilterInput.value.length )
            dojo.addClass( this.textFilterLabel, 'selected' );
        else
            dojo.removeClass( this.textFilterLabel, 'selected' );

    },

    /**
     * Create selection boxes for each searchable facet.
     */
    renderFacetSelectors: function() {
        var container = new dijit.layout.AccordionContainer({style: 'width: 200px'});

        var store = this.trackDataStore;
        this.facetSelectors = {};

        // render a facet selector for a pseudo-facet holding
        // attributes regarding the tracks the user has been working
        // with
        var usageFacet = this._renderFacetSelector(
            'My Tracks', ['Currently Active', 'Recently Used'] );
        usageFacet.set('class', 'myTracks' );
        container.addChild( usageFacet );

        // for the facets from the store, only render facet selectors
        // for ones that are not identity attributes, and have an
        // average bucket size greater than 1
        var storeFacets =
            dojo.filter( store.getFacetNames(),
                         dojo.hitch( this, '_isSelectableFacet', store )
                       );
        dojo.forEach( storeFacets, function(facetName) {

            // get the values of this facet
            var values = store.getFacetValues(facetName).sort();
            if( !values || !values.length )
                return;

            var facetPane = this._renderFacetSelector( facetName, values );
            container.addChild( facetPane );
        },this);

        return container;
    },

    /**
     * Make HTML elements for a single facet selector.
     * @private
     * @returns {dijit.layout.AccordionPane}
     */
    _renderFacetSelector: function( /**String*/ facetName, /**Array[String]*/ values ) {

        var facetPane = new dijit.layout.AccordionPane(
            {
                title: '<div id="facet_title_' + facetName +'" '
                    + 'class="facetTitle">'
                    + Util.ucFirst(facetName)
                    + ' <a class="clearFacet"><img src="img/red_x.png" /></a>'
                    + '</div>'
            });

        // make a selection control for the values of this facet
        var facetControl = dojo.create( 'div', {className: 'facetSelect'}, facetPane.containerNode );
        // populate selector's options
        this.facetSelectors[facetName] = dojo.map(
            values,
            function(val) {
                var that = this;
                var node = dojo.create(
                    'div',
                    { className: 'facetValue',
                      innerHTML: val,
                      onclick: function(evt) {
                          dojo.toggleClass(this, 'selected');
                          that._updateFacetControl( facetName );
                          that.updateQuery();
                      }
                    },
                    facetControl
                );
                node.facetValue = val;
                return node;
            },
            this
        );

        return facetPane;
    },

    /**
     * Clear all the selections from all of the facet controls.
     * @private
     */
    _clearAllFacetControls: function() {
       dojo.forEach( dojof.keys( this.facetSelectors ), function( facetName ) {
           this._clearFacetControl( facetName );
       },this);
    },

    /**
     * Clear all the selections from the facet control with the given name.
     * @private
     */
    _clearFacetControl: function( facetName ) {
        dojo.forEach( this.facetSelectors[facetName] || [], function(selector) {
                          dojo.removeClass(selector,'selected');
                      },this);
        this._updateFacetControl( facetName );
    },

    /**
     * Update the title bar of the given facet control to reflect
     * whether it has selected values in it.
     */
    _updateFacetControl: function( facetName ) {
        var titleContent = dojo.byId('facet_title_'+facetName);

        // if we have some selected values
        if( dojo.some( this.facetSelectors[facetName] || [], function(sel) {
                return dojo.hasClass( sel, 'selected' );
            }, this ) ) {
                var clearFunc = dojo.hitch( this, function(evt) {
                    this._clearFacetControl( facetName );
                    this.updateQuery();
                    evt.stopPropagation();
                });
                dojo.addClass( titleContent, 'selected' );
                dojo.query( '> a', titleContent )
                    .onclick( clearFunc )
                    .attr('title','clear selections');
        }
        // otherwise, no selected values
        else {
                dojo.removeClass( titleContent, 'selected' );
                dojo.query( '> a', titleContent )
                    .onclick( function(){return false;})
                    .removeAttr('title');
        }
    },

    /**
     * Update the query we are using with the track metadata store
     * based on the values of the search form elements.
     */
    updateQuery: function() {
        this._suppressRecursion( '_updateQuery' );
    },
    _updateQuery: function() {
        var newQuery = {};

        var is_selected = function(node) {
            return dojo.hasClass(node,'selected');
        };

        // update from the My Tracks pseudofacet
        (function() {
             var mytracks_options = this.facetSelectors['My Tracks'];

             // index the optoins by name
             var byname = {};
             dojo.forEach( mytracks_options, function(opt){ byname[opt.facetValue] = opt;});

             // if filtering for active tracks, add the labels for the
             // currently selected tracks to the query
             if( is_selected( byname['Currently Active'] ) ) {
                 var activeTrackLabels = dojof.keys(this.tracksActive || {});
                 newQuery.label = Util.uniq(
                     (newQuery.label ||[])
                     .concat( activeTrackLabels )
                 );
             }

             // if filtering for recently used tracks, add the labels of recently used tracks
             if( is_selected( byname['Recently Used'])) {
                 var recentlyUsed = dojo.map(
                     this.browser.getRecentlyUsedTracks(),
                     function(t){
                         return t.label;
                     }
                 );

                 newQuery.label = Util.uniq(
                     (newQuery.label ||[])
                     .concat(recentlyUsed)
                 );
             }

             // finally, if something is selected in here, but we have
             // not come up with any track labels, then insert a dummy
             // track label value that will never match, because the
             // query engine ignores empty arrayrefs.
             if( ( ! newQuery.label || ! newQuery.label.length )
                 && dojo.some( mytracks_options, is_selected )
               ) {
                   newQuery.label = ['FAKE LABEL THAT IS HIGHLY UNLIKELY TO EVER MATCH ANYTHING'];
             }

        }).call(this);

        // update from the text filter
        if( this.textFilterInput.value.length ) {
            newQuery.text = this.textFilterInput.value;
        }

        // update from the data-based facet selectors
        dojo.forEach( this.trackDataStore.getFacetNames(), function(facetName) {
            var options = this.facetSelectors[facetName];
            if( !options ) return;

            var selectedFacets = dojo.map(
                dojo.filter( options, is_selected ),
                function(opt) {return opt.facetValue;}
            );
            if( selectedFacets.length )
                newQuery[facetName] = selectedFacets;
        },this);

        this.query = newQuery;
        this.dataGrid.setQuery( this.query );
        this._updateMatchCount();
    },

    /**
     * Update the match-count text in the grid controls bar based
     * on the last query that was run against the store.
     * @private
     */
    _updateMatchCount: function() {
        var count = this.dataGrid.store.getCount();
        dojo.query( '.matching_record_count', this.containerElem )
            .forEach( function(n) {
                          n.innerHTML = Util.addCommas(count) + ' matching track' + ( count == 1 ? '' : 's' );
                      }
                    );
    },

    /**
     * Update the grid to have only rows checked that correspond to
     * tracks that are currently active.
     * @private
     */
    _updateGridSelections: function() {
        // keep selection events from firing while we mess with the
        // grid
        this._ifNotSuppressed('gridUpdate', function(){
            this._suppress('selectionEvents', function() {
                this.dataGrid.selection.deselectAll();

                // check the boxes that should be checked, based on our
                // internal memory of what tracks should be on.
                for( var i= 0; i < Math.min( this.dataGrid.get('rowCount'), this.dataGrid.get('rowsPerPage') ); i++ ) {
                    var item = this.dataGrid.getItem( i );
                    var label = this.dataGrid.store.getIdentity( item );
                    if( this.tracksActive[label] )
                        this.dataGrid.rowSelectCell.toggleRow( i, true );
                }

            });
        });
    },

    /**
     * Given an array of track configs, update the track list to show
     * that they are turned on.
     */
    setTracksActive: function( /**Array[Object]*/ trackConfigs ) {
        dojo.forEach( trackConfigs, function(conf) {
            this.tracksActive[conf.label] = true;
        },this);
    },

    /**
     * Given an array of track configs, update the track list to show
     * that they are turned off.
     */
    setTracksInactive: function( /**Array[Object]*/ trackConfigs ) {
        dojo.forEach( trackConfigs, function(conf) {
            delete this.tracksActive[conf.label];
        },this);
    },

    /**
     * Make the track selector visible.
     */
    show: function() {
        window.setTimeout( dojo.hitch( this, function() {
            this.textFilterInput.disabled = false;
            this.textFilterInput.focus();
        }), 300);

        dojo.animateProperty({
            node: this.containerElem,
            properties: {
                left: { start: -95, end: 0, units: '%' }
            }
        }).play();

        this.shown = true;
    },

    /**
     * Make the track selector invisible.
     */
    hide: function() {

        dojo.animateProperty({
            node: this.containerElem,
            properties: {
                left: { start: 0, end: -95, units: '%' }
            }
        }).play();

        this.textFilterInput.blur();
        this.textFilterInput.disabled = true;

        this.shown = false;
    },

    /**
     * Toggle whether the track selector is visible.
     */
    toggle: function() {
        this.shown ? this.hide() : this.show();
    }
});