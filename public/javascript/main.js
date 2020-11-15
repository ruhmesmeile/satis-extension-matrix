// Wait for document ready
$(document).ready(function () {
    // Move classes set by Handlebars helper 'version' on span up to td for
    // full width/height background coloring
    $('span.diff--master').each(function(index, element) {
        let spanClasses = element.className;
        $(element).parent().addClass(spanClasses);
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

        // TODO still a bug here, some rotated th's highlight following cells starting in row 2
        const tdIndex = $thHeader.prevAll('th.rotated').length;
        const numberOfDividers = $thHeader.prevAll('th.rotated.divider').length;
        
        $thHeader.parents('table').children('tbody').children('tr').each(function (index, element) {
            let $tds = $(element).find('td');

            if (index === 0) {
                $tds.eq(tdIndex).toggleClass('active')
            } else if ($thHeader.hasClass('divider')) {
            } else {
                $tds.eq(tdIndex - numberOfDividers).toggleClass('active');
            }
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