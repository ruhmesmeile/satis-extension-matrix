// Wait for document ready
$(document).ready(function () {
    // Move classes set by Handlebars helper 'version' on span up to td for
    // full width/height background coloring
    $('span.diff--master').each(function(index, element) {
        let spanClasses = element.className;
        $(element).parent().addClass(spanClasses);
    });

    // Toggle branch (master vs. develop) of distribution,
    // that versions and diffs are based on
    $(document).on('click', '.tgl-btn.tgl-branches', function() {
        $('body').toggleClass('branchToggled');

        if ($('body').hasClass('distributionToggled')) {
            $('.tgl-btn.tgl-distribution').trigger('click');
        }

        if($('body').hasClass('branchToggled')) {
            $('span.diff--master').each(function (index, element) {
                let spanClasses = element.className;
                $(element).parent().removeClass(spanClasses);
            });

            $('span.diff--distribution').each(function (index, element) {
                let spanClasses = element.className;
                $(element).parent().removeClass(spanClasses);
            });

            $('span.diff--develop').each(function (index, element) {
                let spanClasses = element.className;
                $(element).parent().addClass(spanClasses);
            });
        } else {
            $('span.diff--develop').each(function (index, element) {
                let spanClasses = element.className;
                $(element).parent().removeClass(spanClasses);
            });

            $('span.diff--distribution').each(function (index, element) {
                let spanClasses = element.className;
                $(element).parent().removeClass(spanClasses);
            });

            $('span.diff--master').each(function (index, element) {
                let spanClasses = element.className;
                $(element).parent().addClass(spanClasses);
            });
        }
    });

    // Toggle display of version diff coloring based on difference
    // between master and develop branch versions of distribution
    $(document).on('click', '.tgl-btn.tgl-distribution', function () {
        $('body').toggleClass('distributionToggled');

        if($('body').hasClass('distributionToggled')) {
            if($('body').hasClass('branchToggled')) {
                $('span.diff--develop').each(function (index, element) {
                    let spanClasses = element.className;
                    $(element).parent().removeClass(spanClasses);
                });    
            } else {
                $('span.diff--master').each(function (index, element) {
                    let spanClasses = element.className;
                    $(element).parent().removeClass(spanClasses);
                });
            }

            $('span.diff--distribution').each(function (index, element) {
                let spanClasses = element.className;
                $(element).parent().addClass(spanClasses);
            });
        } else {
            $('span.diff--distribution').each(function (index, element) {
                let spanClasses = element.className;
                $(element).parent().removeClass(spanClasses);
            });

            if ($('body').hasClass('branchToggled')) {
                $('span.diff--develop').each(function (index, element) {
                    let spanClasses = element.className;
                    $(element).parent().addClass(spanClasses);
                });
            } else {
                $('span.diff--master').each(function (index, element) {
                    let spanClasses = element.className;
                    $(element).parent().addClass(spanClasses);
                });
            }
        }
    });


    // Toggles active class on rows, in turn triggering display of version
    // diff info (colors) and current version on respective row cells
    let toggleActiveRow = function toggleActiveRow(ev) {
        const $thHeader = $(ev.currentTarget);
        const $trHeader = $thHeader.parent();

        const trIndex = $trHeader.prevAll('tr').length;
        const $trItems = $trHeader.parents('table').siblings('table').children('tbody').children('tr').eq(trIndex);

        $trHeader.toggleClass('active');
        $trItems.toggleClass('active');
    }

    // Toggles active class on column tds, in turn triggering display of version
    // diff info (colors) and current version on respective column cells
    let toggleActiveColumn = function toggleActiveColumn(ev) {
        const $thHeader = $(ev.currentTarget);

        const tdIndex = $thHeader.prevAll('th.rotated').length;
        $thHeader.parents('table').children('tbody').children('tr').each(function (index, element) {
            let $tds = $(element).find('td');
            index === 0
                ? $tds.eq(tdIndex).toggleClass('active')
                : $tds.eq(tdIndex - 1).toggleClass('active');
        });

        $thHeader.toggleClass('active');
    }

    // Bind row event handlers to hover on respective cells
    $(document).on({
        mouseenter: toggleActiveRow,
        mouseleave: toggleActiveRow,
    }, '#table-header tbody th, #table-items tbody td');

    // Bind column event handlers to hover on respective cells
    $(document).on({
        mouseenter: toggleActiveColumn,
        mouseleave: toggleActiveColumn,
    }, '#table-items thead th');
});